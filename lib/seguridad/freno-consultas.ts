/**
 * Freno de las consultas caras: historico, estadisticas, importar el reporte
 * de citas y la purga.
 *
 * POR QUE EXISTE. Son las unicas rutas que leen o escriben miles de filas de
 * una vez. nginx ya limita peticiones por IP, pero con un umbral pensado para
 * que una oficina entera navegue tranquila, y eso deja pasar de sobra a un
 * script (o a una pestaña en bucle) que dispare informes seguidos: cada uno
 * ocupa una conexion del pool de la base durante segundos, y cuando se acaban
 * lo primero que se cae es el inicio de sesion y el llamado de turnos.
 *
 * Tres capas, de la mas fina a la mas gruesa:
 *   1. Por USUARIO: lo que una persona puede pedir razonablemente.
 *   2. Por IP, amplio: todo el hospital comparte una IP, asi que el tope es
 *      diez veces el de una persona; solo lo alcanza una avalancha.
 *   3. Un TECHO GLOBAL de consultas caras a la vez, venga de donde venga: la
 *      que no cabe recibe un 503 en el acto en vez de hacer cola sobre el pool.
 */
import { limitarIntentos } from './limitador'

export type ConsultaPesada = 'historico' | 'estadisticas' | 'importar' | 'purga_vista' | 'purga'

interface Limite {
  porUsuario: number
  porOrigen: number
  ventanaMs: number
}

const UN_MINUTO = 60_000

/**
 * Cuanto se permite de cada una. Una linea por consulta cara nueva.
 *
 * El historico y las estadisticas se recargan al mover un filtro: dos por
 * segundo sostenidos por persona es mucho mas de lo que teclea nadie. Importar
 * y purgar son acciones de administracion que se hacen una vez al dia.
 */
const LIMITES: Record<ConsultaPesada, Limite> = {
  historico: { porUsuario: 120, porOrigen: 1200, ventanaMs: UN_MINUTO },
  estadisticas: { porUsuario: 60, porOrigen: 600, ventanaMs: UN_MINUTO },
  importar: { porUsuario: 20, porOrigen: 60, ventanaMs: 10 * UN_MINUTO },
  // La vista previa y la purga real van con CUPOS SEPARADOS: compartiendo uno,
  // mover la fecha del formulario gastaba el cupo y la purga de verdad recibia
  // un 429 justo al confirmar.
  purga_vista: { porUsuario: 60, porOrigen: 300, ventanaMs: 10 * UN_MINUTO },
  purga: { porUsuario: 10, porOrigen: 30, ventanaMs: 10 * UN_MINUTO },
}

/** "1 minuto", "10 minutos": cuanto hay que esperar, dicho como se dice. */
function minutosDe(ms: number): string {
  const minutos = Math.max(1, Math.ceil(ms / UN_MINUTO))
  return minutos === 1 ? '1 minuto' : `${minutos} minutos`
}

export class DemasiadasPeticiones extends Error {
  readonly status = 429

  /** `ventanaMs`: la ventana del freno que salto, que es lo que dura la espera. */
  constructor(ventanaMs: number) {
    super(
      `Se hicieron demasiadas consultas de este tipo en poco tiempo. Espera como mucho ${minutosDe(ventanaMs)} y vuelve a intentarlo.`,
    )
    this.name = 'DemasiadasPeticiones'
  }
}

export class ServidorOcupado extends Error {
  readonly status = 503
  /** Marca que `apiError` exige para dejar pasar un 503 con su mensaje. */
  readonly vuelveAIntentarlo = true

  constructor() {
    super('El servidor esta generando otros informes en este momento. Vuelve a intentarlo en unos segundos.')
    this.name = 'ServidorOcupado'
  }
}

function excede(accion: string, clave: string, limite: number, ventanaMs: number): boolean {
  return !limitarIntentos(accion, clave, limite, ventanaMs).permitido
}

/** Lanza `DemasiadasPeticiones` (429) si esa persona o esa IP ya pidieron demasiado. */
export function frenarConsultaPesada(tipo: ConsultaPesada, quien: { usuarioId: string; ip: string | null }) {
  const { porUsuario, porOrigen, ventanaMs } = LIMITES[tipo]
  if (quien.ip && excede(`${tipo}_ip`, quien.ip, porOrigen, ventanaMs)) throw new DemasiadasPeticiones(ventanaMs)
  if (excede(`${tipo}_usuario`, quien.usuarioId, porUsuario, ventanaMs)) throw new DemasiadasPeticiones(ventanaMs)
}

export interface Semaforo {
  ejecutar: <T>(tarea: () => Promise<T>) => Promise<T>
}

/**
 * Deja correr como mucho `maximo` tareas a la vez; la que no cabe recibe
 * `ServidorOcupado` (503) sin esperar. Sin cola a proposito: una cola larga
 * de informes solo retrasa el problema y retiene memoria mientras tanto.
 */
export function crearSemaforo(maximo: number): Semaforo {
  let activas = 0

  return {
    async ejecutar(tarea) {
      if (activas >= maximo) throw new ServidorOcupado()
      activas += 1
      try {
        return await tarea()
      } finally {
        activas -= 1
      }
    },
  }
}

/**
 * Cuantas consultas caras corren a la vez en todo el servidor.
 *
 * Por debajo del `connection_limit` del pool de la base (10 recomendado en
 * docs/despliegue.md): asi siempre quedan conexiones libres para el inicio de
 * sesion, el llamado y la pantalla de la sala.
 */
const MAXIMO_POR_DEFECTO = 4

function topeDeConsultasPesadas(): number {
  const declarado = Number(process.env.TURNOS_MAX_CONSULTAS_PESADAS)
  return Number.isInteger(declarado) && declarado > 0 ? declarado : MAXIMO_POR_DEFECTO
}

declare global {
  var __turnosConsultasPesadas: Semaforo | undefined
}

// En `globalThis` como el aforo del canal: dos contadores a medias no son un tope.
const consultasPesadas: Semaforo = globalThis.__turnosConsultasPesadas ?? crearSemaforo(topeDeConsultasPesadas())
globalThis.__turnosConsultasPesadas = consultasPesadas

/** Corre la consulta dentro del techo global (el freno por usuario e IP va aparte). */
export function ejecutarConsultaPesada<T>(consulta: () => Promise<T>): Promise<T> {
  return consultasPesadas.ejecutar(consulta)
}

/** Frena por usuario e IP y corre la consulta dentro del techo global. */
export function conFrenoDeConsultaPesada<T>(
  tipo: ConsultaPesada,
  quien: { usuarioId: string; ip: string | null },
  consulta: () => Promise<T>,
): Promise<T> {
  frenarConsultaPesada(tipo, quien)
  return consultasPesadas.ejecutar(consulta)
}

/**
 * Aforo del canal de eventos en vivo (SSE).
 *
 * POR QUE EXISTE. `GET /api/turnos/stream` es publico y no pide sesion: lo
 * consume el televisor de la sala de espera, que no inicia sesion a nadie
 * (requerimiento seccion 6.3). Cada conexion abierta cuesta un listener en el
 * hub y un temporizador de latido cada 20 s que solo se apaga cuando esa
 * conexion se cierra. Sin un tope, un bucle de peticiones desde cualquier
 * equipo de la red del hospital abre conexiones hasta agotar la memoria y los
 * descriptores del servidor, y lo primero que deja de funcionar es justo lo
 * que depende del canal: la pantalla de la sala de espera y la fila de todos
 * los consultorios.
 *
 * `setMaxListeners(100)` del hub NO es un limite: solo calla el aviso de Node
 * cuando se pasan de cien. Aqui si se cuenta y se rechaza.
 *
 * ESTO NO ES EL LIMITADOR DE INTENTOS. `limitarIntentos` cuenta FALLOS dentro
 * de una ventana de tiempo; esto cuenta conexiones ABIERTAS AHORA MISMO, y
 * baja cuando se cierran. Son dos cosas distintas y por eso no se reutiliza.
 */

/** Cuantas conexiones simultaneas se atienden en total. */
const MAXIMO_POR_DEFECTO = 200

/**
 * Cuantas conexiones simultaneas se le permiten a un mismo origen.
 *
 * Solo se aplica cuando hay un proxy declarado (`confiarEnProxy`), porque sin
 * el la IP la escribe el propio cliente: limitar por un dato que el atacante
 * elige no frena nada y si puede dejar fuera al hospital entero.
 *
 * Veinte es holgado a proposito: un mismo equipo puede tener la pantalla, el
 * monitor del administrador y alguna pestaña olvidada, y las conexiones que
 * quedan colgando tardan un rato en soltarse.
 */
const MAXIMO_POR_ORIGEN_POR_DEFECTO = 20

/** Lee un tope del entorno. Un valor invalido no apaga la proteccion. */
function topeDelEntorno(variable: string, porDefecto: number): number {
  const declarado = Number(process.env[variable])
  return Number.isInteger(declarado) && declarado > 0 ? declarado : porDefecto
}

/** Una plaza ocupada en el canal. Soltarla es idempotente. */
export interface PlazaDelCanal {
  soltar: () => void
}

export type MotivoDeRechazo = 'aforo_global' | 'aforo_por_origen'

export type ResultadoDeAforo =
  | { admitida: true; plaza: PlazaDelCanal }
  | { admitida: false; motivo: MotivoDeRechazo }

/**
 * Cuanto se espera entre dos apuntes de rechazo en el registro de actividad.
 *
 * EL AVISO NO PUEDE SER EL SIGUIENTE PROBLEMA. Cada rechazo se anota en la
 * base; sin freno, una avalancha de mil conexiones por segundo se convierte en
 * mil escrituras por segundo contra el mismo pool que usa el inicio de sesion,
 * que es exactamente lo que este modulo evita. Con un apunte cada diez
 * segundos, quien audita ve igual que hubo rechazos y cuando, que es lo que
 * necesita saber.
 */
const MS_ENTRE_AVISOS = 10_000

interface Aforo {
  total: number
  porOrigen: Map<string, number>
  /** Cuando se anoto el ultimo rechazo. Ver `MS_ENTRE_AVISOS`. */
  ultimoAviso: number
}

declare global {
  var __turnosAforoCanal: Aforo | undefined
}

// En `globalThis` por el mismo motivo que el hub: Next puede evaluar este
// modulo en mas de un contexto, y dos contadores a medias no son un tope.
const aforo: Aforo = globalThis.__turnosAforoCanal ?? {
  total: 0,
  porOrigen: new Map(),
  ultimoAviso: 0,
}
globalThis.__turnosAforoCanal = aforo

/**
 * Si este rechazo se anota en el registro de actividad.
 *
 * Se consulta UNA vez por rechazo y va contando: ver `MS_ENTRE_AVISOS`.
 */
export function tocaAnotarElRechazo(): boolean {
  const ahora = Date.now()
  if (ahora - aforo.ultimoAviso < MS_ENTRE_AVISOS) return false
  aforo.ultimoAviso = ahora
  return true
}

/** Cuantas conexiones hay abiertas ahora mismo. */
export function conexionesActivas(): number {
  return aforo.total
}

function ocupacionDelOrigen(origen: string): number {
  return aforo.porOrigen.get(origen) ?? 0
}

function anotarOrigen(origen: string | null) {
  if (!origen) return
  aforo.porOrigen.set(origen, ocupacionDelOrigen(origen) + 1)
}

/**
 * Descuenta el origen y lo BORRA del mapa cuando llega a cero.
 *
 * Si se quedaran las entradas en cero, el mapa crecería una entrada por cada
 * IP que alguna vez se conecto: la misma fuga de memoria que este modulo
 * existe para cerrar, entrando por otra puerta.
 */
function olvidarOrigen(origen: string | null) {
  if (!origen) return
  const restantes = ocupacionDelOrigen(origen) - 1
  if (restantes > 0) aforo.porOrigen.set(origen, restantes)
  else aforo.porOrigen.delete(origen)
}

/**
 * La plaza, con su bandera propia.
 *
 * La bandera es obligatoria: la conexion se suelta desde `cancel()` (el
 * televisor se apago) y tambien desde el `limpiar()` que corre cuando falla un
 * envio, asi que la misma conexion pasa por aqui dos veces. Descontando dos
 * veces, el contador se iria por debajo de lo real y el tope acabaria siendo
 * decorativo.
 */
function crearPlaza(origen: string | null): PlazaDelCanal {
  let soltada = false

  return {
    soltar() {
      if (soltada) return
      soltada = true
      aforo.total -= 1
      olvidarOrigen(origen)
    },
  }
}

/**
 * Reserva una plaza en el canal.
 *
 * `origen` viene en null cuando no hay proxy declarado; entonces solo cuenta el
 * tope global (ver la nota de `MAXIMO_POR_ORIGEN_POR_DEFECTO`).
 */
export function ocuparPlaza(origen: string | null): ResultadoDeAforo {
  if (aforo.total >= topeDelEntorno('TURNOS_MAX_CANAL_EN_VIVO', MAXIMO_POR_DEFECTO)) {
    return { admitida: false, motivo: 'aforo_global' }
  }

  const topePorOrigen = topeDelEntorno(
    'TURNOS_MAX_CANAL_EN_VIVO_POR_ORIGEN',
    MAXIMO_POR_ORIGEN_POR_DEFECTO,
  )

  if (origen && ocupacionDelOrigen(origen) >= topePorOrigen) {
    return { admitida: false, motivo: 'aforo_por_origen' }
  }

  aforo.total += 1
  anotarOrigen(origen)

  return { admitida: true, plaza: crearPlaza(origen) }
}

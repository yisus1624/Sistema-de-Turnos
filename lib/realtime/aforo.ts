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
/**
 * Cuantas conexiones simultaneas se atienden en total.
 *
 * Es el tope que protege la memoria del servidor, venga de donde venga la
 * avalancha. ALTO A PROPOSITO: con 300, tres IPs atacantes con su tope por IP
 * lleno (100 cada una) dejaban la sala de espera sin pantalla. Cada conexion
 * cuesta poco (un oyente y un temporizador), asi que 2000 es viable en la VPS
 * y deja al hospital sitio de sobra aunque varias IPs abusen a la vez. El hub
 * ajusta su aviso de oyentes a este mismo numero.
 */
const MAXIMO_POR_DEFECTO = 2000

/**
 * Cuantas conexiones simultaneas se le permiten a un mismo origen (IP).
 *
 * Solo se aplica cuando hay un proxy declarado (`confiarEnProxy`), porque sin
 * el la IP la escribe el propio cliente: limitar por un dato que el atacante
 * elige no frena nada.
 *
 * ALTO A PROPOSITO. Todo el hospital sale por UNA IP (el NAT), y esa IP cambia
 * sin aviso: no se puede eximir ni configurar. Cien alcanza para ~30 pantallas
 * mas la reconexion masiva tras un corte, cuando las conexiones viejas siguen
 * contando hasta que el reciclado de 4-6 minutos las suelta. Con el tope
 * anterior (20), tras un corte de un minuto solo volvian 2 pantallas de 18. Y
 * sigue frenando a una IP que abre cientos de conexiones.
 */
const MAXIMO_POR_ORIGEN_POR_DEFECTO = 100

/** Lee un tope del entorno. Un valor invalido no apaga la proteccion. */
function topeDelEntorno(variable: string, porDefecto: number): number {
  const declarado = Number(process.env[variable])
  return Number.isInteger(declarado) && declarado > 0 ? declarado : porDefecto
}

/**
 * Cuantas conexiones en vivo admite el servidor como maximo.
 *
 * LO NECESITA TAMBIEN EL HUB, y de ahi que este exportado. Cada conexion SSE
 * engancha exactamente un oyente al hub, que tenia su propio tope escrito a
 * mano (100) mientras el aforo admitia 200: el sistema estaba configurado para
 * pasarse de su propio umbral de aviso, y al hacerlo Node empezaba a escupir
 * `MaxListenersExceededWarning` con traza en cada suscripcion. Dos numeros que
 * tienen que moverse juntos no pueden vivir en dos archivos.
 */
export function topeDeConexionesEnVivo(): number {
  return topeDelEntorno('TURNOS_MAX_CANAL_EN_VIVO', MAXIMO_POR_DEFECTO)
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

/** Si el origen ya agoto su cupo. Sin IP de fiar no hay cupo por origen. */
function origenLleno(origen: string | null): boolean {
  if (!origen) return false
  const tope = topeDelEntorno('TURNOS_MAX_CANAL_EN_VIVO_POR_ORIGEN', MAXIMO_POR_ORIGEN_POR_DEFECTO)
  return ocupacionDelOrigen(origen) >= tope
}

/**
 * Reserva una plaza en el canal.
 *
 * `origen` viene en null cuando no hay proxy declarado, y entonces solo cuenta
 * el tope global (ver la nota de `MAXIMO_POR_ORIGEN_POR_DEFECTO`).
 */
export function ocuparPlaza(origen: string | null): ResultadoDeAforo {
  if (aforo.total >= topeDeConexionesEnVivo()) {
    return { admitida: false, motivo: 'aforo_global' }
  }

  if (origenLleno(origen)) {
    return { admitida: false, motivo: 'aforo_por_origen' }
  }

  aforo.total += 1
  anotarOrigen(origen)

  return { admitida: true, plaza: crearPlaza(origen) }
}

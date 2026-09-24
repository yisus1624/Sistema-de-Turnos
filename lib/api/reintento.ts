/**
 * Reintento autonomo de una carga que fallo, con espera creciente.
 *
 * POR QUE EXISTE. Las pantallas se ponen al dia con el canal en vivo, que solo
 * avisa cuando PASA algo. Si la carga falla (429 de nginx, 500, espera vencida)
 * y el canal sigue vivo, nadie volvia a intentarlo: el consultorio se quedaba
 * en "Sin conexion con el servidor" —prometiendo que "se carga solo"— hasta el
 * siguiente evento que le interesara, que en una mañana tranquila podia tardar
 * media hora. Ahora la pantalla reintenta por su cuenta hasta lograrlo.
 *
 * Una sola pieza para todas las pantallas (consultorio, operador, monitor del
 * administrador y televisor), sin React: se prueba en Node y la envuelve
 * `useReintento` en `lib/hooks.ts`.
 */
import { programadorReal, type Programador } from '@/lib/programador'
import { ErrorApi, esCancelacion, esRechazoDeAcceso } from './cliente'

/** Primera espera antes de reintentar. */
const MS_REINTENTO_INICIAL = 2000

/** Tope de esa espera, que se duplica en cada intento fallido. */
const MS_REINTENTO_MAXIMO = 30000

/**
 * Espera antes del intento numero `intento` (empezando en 0): se duplica en
 * cada fallo hasta el tope, con un poco de azar para que todo el hospital no
 * se reconecte en el mismo milisegundo cuando vuelve la red o el servidor.
 */
export function esperaDeReintento(intento: number, azar = Math.random()): number {
  const base = Math.min(MS_REINTENTO_MAXIMO, MS_REINTENTO_INICIAL * 2 ** intento)
  return Math.round(base * (0.75 + azar * 0.5))
}

/** Estados HTTP que se arreglan esperando: la espera vencio, demasiadas peticiones, el servidor. */
function esEstadoPasajero(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

/**
 * Si vale la pena volver a intentarlo: los fallos de red y los estados
 * pasajeros (408, 429, 5xx). No un 401/403 —enlace vencido o permiso
 * retirado—, ni un 400/404, que repetir no arregla, ni lo que cancelo la
 * propia pantalla.
 */
export function esReintentable(error: unknown): boolean {
  if (esCancelacion(error) || esRechazoDeAcceso(error)) return false
  return error instanceof ErrorApi ? esEstadoPasajero(error.status) : true
}

export type { Programador }

export interface Reintento {
  /**
   * Tras un fallo: ejecuta `accion` despues de la espera que toque. La accion
   * se pasa aqui y no al crear el reintento, para que sea siempre la vigente.
   */
  programar: (accion: () => void) => void
  /** Salio bien: cancela lo pendiente y la espera vuelve a empezar corta. */
  exito: () => void
  /** Al desmontar la pantalla. Definitivo: despues ya no programa nada. */
  cancelar: () => void
}

export function crearReintento(
  opciones: { programar?: Programador; espera?: (intento: number) => number } = {},
): Reintento {
  const { programar = programadorReal, espera = esperaDeReintento } = opciones
  let fallosSeguidos = 0
  let pendiente: (() => void) | null = null
  // Definitivo: una carga que falle DESPUES de salir de la pantalla ya no puede
  // volver a programar nada. Sin esto quedaba un ciclo zombi pidiendo cada 30 s.
  let terminado = false

  const soltarPendiente = () => {
    pendiente?.()
    pendiente = null
  }

  return {
    // Uno a la vez: varios fallos juntos (la carga y un evento) no apilan
    // reintentos ni saltan la espera.
    programar(accion) {
      if (terminado || pendiente) return
      pendiente = programar(() => {
        pendiente = null
        accion()
      }, espera(fallosSeguidos++))
    },
    exito() {
      fallosSeguidos = 0
      soltarPendiente()
    },
    cancelar() {
      terminado = true
      soltarPendiente()
    },
  }
}

/** Cuantas comprobaciones de un rechazo van al ritmo corto antes de espaciarse. */
const COMPROBACIONES_SEGUIDAS = 10
const MS_COMPROBAR_RECHAZO = 30_000
const MS_COMPROBAR_RECHAZO_ESPACIADO = 5 * 60_000

/**
 * Espera antes de volver a comprobar un acceso RECHAZADO (401/403).
 *
 * Un rechazo no siempre es definitivo: el freno del servidor o un intermediario
 * (nginx, un WAF) cortan un rato y se levantan solos. Por eso no se abandona,
 * pero tampoco se martilla como un fallo de red: cada intento con un enlace
 * vencido de verdad queda apuntado en el registro de seguridad, que tiene que
 * seguir sirviendo para encontrar los intentos que importan. Las primeras
 * comprobaciones van cada 30 a 60 segundos, lo que dura un freno pasajero;
 * despues, cada 5 a 10 minutos. Con azar, para que las pantallas rechazadas a
 * la vez no vuelvan todas en el mismo segundo.
 */
export function esperaTrasRechazo(intento: number, azar = Math.random()): number {
  const base = intento < COMPROBACIONES_SEGUIDAS ? MS_COMPROBAR_RECHAZO : MS_COMPROBAR_RECHAZO_ESPACIADO
  return Math.round(base * (1 + azar))
}

/**
 * Vuelve a llamar a `comprobar` cada tanto hasta que se detiene: tras cada
 * comprobacion, salga como salga, programa la siguiente (ver
 * `esperaTrasRechazo`). La pantalla la detiene cuando vuelve a entrar o al
 * salir; detenida, ya no programa nada.
 */
export function crearComprobacionPeriodica(
  comprobar: () => Promise<unknown>,
  opciones: { programar?: Programador } = {},
): { detener: () => void } {
  const ciclo = crearReintento({ programar: opciones.programar, espera: esperaTrasRechazo })
  const siguiente = () => ciclo.programar(() => void comprobar().then(siguiente, siguiente))
  siguiente()
  return { detener: () => ciclo.cancelar() }
}

/**
 * Lo que devuelve una carga: nada si pinto sus datos, o 'reemplazada' si salio
 * otra mas nueva mientras viajaba (ver `lib/api/ultima-peticion.ts`).
 */
export type ResultadoDeCarga = 'reemplazada' | void

/**
 * Corre una carga y decide que hacer con su desenlace.
 *
 * Si sale bien, la espera vuelve a empezar corta. Si falla por algo pasajero,
 * se programa `alReintentar`. Si la reemplazo otra mas nueva, NO cuenta como
 * exito ni como fallo: esa otra decidira, y reiniciar la espera aqui la
 * dejaria martillando al servidor durante un corte.
 */
export async function cargarConReintento(
  cargar: () => Promise<ResultadoDeCarga>,
  reintento: Reintento,
  alReintentar: () => void,
): Promise<void> {
  try {
    if ((await cargar()) === 'reemplazada') return
    reintento.exito()
  } catch (error) {
    if (esReintentable(error)) reintento.programar(alReintentar)
  }
}

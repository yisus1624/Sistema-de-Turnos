import type { Turno } from './types'

/**
 * Error de regla de negocio: el dato que llego es invalido, no fallo el
 * servidor.
 *
 * Importa distinguirlo: un 500 dice "el sistema se rompio" y termina en las
 * alertas de soporte, mientras que estos casos (prefijo repetido, cita ya
 * registrada, turno inexistente) son culpa del dato y se responden con 400.
 * `apiError` lee la propiedad `status`.
 */
export class ErrorDeNegocio extends Error {
  readonly status = 400

  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeNegocio'
  }
}

export function errorDeNegocio(mensaje: string): never {
  throw new ErrorDeNegocio(mensaje)
}

/**
 * La base no pudo atender la operacion a tiempo (503): transaccion que no
 * consiguio conexion o se paso de tiempo, o un choque con otra transaccion
 * (bloqueo mutuo). No es culpa del dato ni un fallo permanente: repetir en
 * unos segundos lo resuelve, y es lo que se le dice al funcionario en vez de
 * "problema del sistema".
 */
export class ErrorPasajero extends Error {
  readonly status = 503
  /** Marca que `apiError` exige para dejar pasar un 503 con su mensaje. */
  readonly vuelveAIntentarlo = true

  constructor() {
    super('El sistema esta muy ocupado en este momento. Vuelve a intentarlo en unos segundos.')
    this.name = 'ErrorPasajero'
  }
}

/**
 * El estado real ya no es el que el funcionario tenia en pantalla (409).
 *
 * Pasa sobre todo con la red lenta: la respuesta de una accion se pierde, el
 * funcionario vuelve a pulsar y la segunda peticion encuentra otra cosa. No es
 * un dato invalido (400) ni un fallo del sistema (500): es "mira primero como
 * esta de verdad". Por eso viaja con `turnoActual`, el turno abierto real, para
 * que la pantalla se ponga al dia sin tener que adivinarlo.
 */
export class ConflictoDeTurno extends Error {
  readonly status = 409
  readonly turnoActual: Turno | null

  constructor(mensaje: string, turnoActual: Turno | null = null) {
    super(mensaje)
    this.name = 'ConflictoDeTurno'
    this.turnoActual = turnoActual
  }

  /** Lo que `apiError` agrega a la respuesta, ademas del mensaje. */
  get datosParaCliente() {
    return { turnoActual: this.turnoActual }
  }
}

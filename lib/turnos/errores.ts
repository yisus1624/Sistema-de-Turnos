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

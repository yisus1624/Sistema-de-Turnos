/**
 * "La ultima peticion gana" para las recargas de una pantalla.
 *
 * POR QUE EXISTE. La pantalla del doctor y la del operador se recargan desde
 * tres sitios a la vez: el canal en vivo, el final de cada accion y el cambio
 * de servicio, ventanilla o fecha. Con la red lenta las respuestas llegan
 * desordenadas, y una vieja que llegaba tarde pintaba "sin paciente" o el turno
 * de otra ventanilla encima del estado bueno; el siguiente clic se hacia sobre
 * esa pantalla equivocada y cerraba mal.
 *
 * Cada recarga pide un turno con `iniciar()`: eso cancela la anterior (su
 * `signal` se aborta, la red la suelta) y la deja sin vigencia, asi que aunque
 * su respuesta llegue igual, ya no se aplica. No depende de React: se prueba en
 * Node y la envuelve `useUltimaPeticion` en `lib/hooks.ts`.
 */

export interface PeticionEnCurso {
  signal: AbortSignal
  /** Si sigue siendo la ultima: solo entonces se aplica su respuesta. */
  esVigente: () => boolean
}

export interface UltimaPeticion {
  iniciar: () => PeticionEnCurso
  /** Cancela la que este en curso (al desmontar la pantalla). */
  cancelar: () => void
}

export function crearUltimaPeticion(): UltimaPeticion {
  let actual: AbortController | null = null

  const cancelar = () => {
    actual?.abort()
    actual = null
  }

  const iniciar = (): PeticionEnCurso => {
    cancelar()
    const propia = new AbortController()
    actual = propia
    return { signal: propia.signal, esVigente: () => actual === propia }
  }

  return { iniciar, cancelar }
}

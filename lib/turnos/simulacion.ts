/**
 * Interruptor del panel de simulacion de carga.
 *
 * Vive aqui, y no dentro del route handler, porque lo tienen que leer los dos
 * lados: la API —para negarse a reiniciar el dia— y la PANTALLA —para no
 * ofrecer un boton que el servidor va a rechazar—. Que la pantalla ofreciera
 * "Preparar simulacion", pidiera una confirmacion en rojo y solo despues
 * respondiera 403 era el error: el administrador aceptaba borrar la jornada,
 * no pasaba nada, y el registro decia que la simulacion estaba deshabilitada
 * "en este servidor" sin que en ninguna parte se explicara cual servidor ni
 * por que. Un boton que no puede funcionar tiene que verse apagado ANTES de
 * pulsarlo.
 *
 * El valor por defecto sigue siendo "apagada" fuera de desarrollo: este panel
 * rehace el recorrido del turno de hoy y le genera enlaces nuevos a los
 * doctores, que es justo lo que no puede pasar en mitad de una jornada real.
 * El entorno de demostracion la enciende con TURNOS_SIMULACION=1.
 */

export function simulacionHabilitada(): boolean {
  return process.env.TURNOS_SIMULACION === '1' || process.env.NODE_ENV !== 'production'
}

/**
 * Por que esta apagada, en las palabras que le sirven a quien la ve apagada.
 *
 * Es el mismo texto en la API y en la pantalla: si el administrador lo lee en
 * el registro y en el aviso, no tiene que adivinar que son lo mismo.
 */
export const MOTIVO_SIMULACION_APAGADA =
  'La simulacion de carga esta apagada en este servidor: rehace los turnos del dia y les cambia el ' +
  'enlace a los doctores, y aqui esta la agenda real del hospital. Se enciende con TURNOS_SIMULACION=1, ' +
  'que solo se pone en el servidor de demostracion.'

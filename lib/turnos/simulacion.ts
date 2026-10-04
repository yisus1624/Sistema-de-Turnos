/**
 * Interruptor del panel de simulacion de carga.
 *
 * Vive aqui, y no dentro del route handler, porque lo tienen que leer los dos
 * lados: la API —para negarse a reiniciar el dia— y la PANTALLA —para no
 * ofrecer un boton que el servidor va a rechazar—. Un boton que no puede
 * funcionar tiene que verse apagado ANTES de pulsarlo.
 *
 * SOLO LA CUENTA DE DEMOSTRACION. La simulacion rehace la jornada del dia y
 * genera enlaces nuevos a los doctores; contra la base real eso vaciaba la
 * sala de espera. La cuenta de demostracion trabaja sobre un hospital de
 * mentira en memoria (`lib/demostracion/mundo.ts`), asi que ahi puede correr
 * siempre, y en ningun otro sitio hace falta.
 */

export function simulacionHabilitada(sesion?: { user: { demostracion?: boolean } } | null): boolean {
  return sesion?.user.demostracion === true
}

/**
 * Por que esta apagada, en las palabras que le sirven a quien la ve apagada.
 *
 * Es el mismo texto en la API y en la pantalla: si el administrador lo lee en
 * el registro y en el aviso, no tiene que adivinar que son lo mismo.
 */
export const MOTIVO_SIMULACION_APAGADA =
  'La simulacion de carga solo corre en la cuenta de demostracion, que tiene un hospital de prueba ' +
  'aparte. Aqui estan los datos reales del hospital: entra con la cuenta de demostracion para mostrarla.'

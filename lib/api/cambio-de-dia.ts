/**
 * Que fecha mostrar cuando cambia el dia con la pantalla abierta.
 *
 * Las pantallas que arrancan en "hoy" fijaban la fecha al abrirse; abiertas de
 * un dia para otro, seguian en el dia anterior pasada la medianoche de
 * Colombia. Quien estaba mirando hoy pasa al nuevo hoy; quien eligio otro dia
 * a proposito se queda donde estaba. Pura, para poder probarla; la aplica
 * `useFechaQueSigueAHoy` en `lib/hooks.ts`.
 */
export function fechaTrasCambioDeDia(elegida: string, hoyAnterior: string, hoyNuevo: string): string {
  return elegida === hoyAnterior ? hoyNuevo : elegida
}

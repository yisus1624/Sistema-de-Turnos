/**
 * Avisos en vivo que se publican DESDE LOS ROUTE HANDLERS, no desde el dominio.
 *
 * El repositorio en memoria publica algunos eventos por su cuenta (deuda
 * conocida: el dominio no deberia conocer la infraestructura de tiempo real).
 * Los avisos nuevos se emiten aqui, y quien los dispara es la ruta que acaba de
 * ejecutar la operacion, para no seguir engordando ese acoplamiento.
 *
 * MINIMIZACION DE DATOS: este canal termina en la pantalla de la sala de
 * espera, que no tiene sesion. Por eso el aviso lleva SOLO a que fila afecta
 * (servicio y profesional), nunca el turno ni nada del paciente.
 */
import { realtimeHub } from './hub'
import type { Turno } from '@/lib/turnos/types'

/**
 * Avisa que la fila de espera de ese servicio (y, si aplica, de ese
 * profesional) cambio: quien la este atendiendo debe recargar sus pendientes.
 */
export function avisarFilaCambiada(turno: Turno): void {
  realtimeHub.publish({
    tipo: 'fila.cambiada',
    servicioId: turno.servicioId,
    profesionalId: turno.profesionalId ?? null,
  })
}

/** Los turnos de hoy se reiniciaron (panel de simulacion): todos a resincronizar. */
export function avisarDatosReiniciados(): void {
  realtimeHub.publish({ tipo: 'datos.reiniciados' })
}

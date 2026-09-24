/**
 * El dia que se mira en una pantalla con selector de fecha: escribirlo y
 * moverlo un dia, SIN LANZAR NUNCA.
 *
 * El selector de fecha queda vacio ('') mientras se corrige con Retroceso, y
 * admite años de cinco cifras. Con esa fecha, `Intl.DateTimeFormat` y
 * `toISOString` lanzaban "Invalid time value" en pleno render y la Agenda
 * entera moria. Puro, para poder probarlo.
 */
import { esFechaValida } from '@/lib/turnos/tiempo'

/** "martes, 14 de abril de 2026": el dia escrito. '' si la fecha no es valida. */
export function fechaLarga(fecha: string): string {
  if (!esFechaValida(fecha)) return ''
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(new Date(`${fecha}T12:00:00-05:00`))
}

/**
 * El dia `dias` antes o despues. Se calcula a mediodia UTC y no con la zona
 * del navegador: partiendo de medianoche, un equipo en otra zona saltaria dos
 * dias o ninguno. Una fecha invalida se deja como esta.
 */
export function diaVecino(fecha: string, dias: number): string {
  if (!esFechaValida(fecha)) return fecha
  const dia = new Date(`${fecha}T12:00:00Z`)
  dia.setUTCDate(dia.getUTCDate() + dias)
  return dia.toISOString().slice(0, 10)
}

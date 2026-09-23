/**
 * La cita que el operador agenda a mano sobre una franja de la parrilla.
 *
 * LA FECHA VIAJA CON LA CELDA. Se fija al abrir la franja y no se vuelve a
 * leer del selector al guardar: el selector sigue a "hoy" y a medianoche pasa
 * solo al dia siguiente, asi que con el modal abierto a esa hora la cita caia
 * en un dia que el operador no habia elegido.
 */

/** La franja elegida en la parrilla: de que dia, con que doctor y a que hora. */
export type CeldaDeAgenda = {
  fecha: string
  profesionalId: string
  profesionalNombre: string
  hora: string
}

export function celdaDeAgenda(fecha: string, profesional: { id: string; nombre: string }, hora: string): CeldaDeAgenda {
  return { fecha, profesionalId: profesional.id, profesionalNombre: profesional.nombre, hora }
}

/**
 * Instante ISO de una franja del dia EN COLOMBIA.
 *
 * El desfase va escrito a mano (-05:00) y no se usa la zona del navegador: es
 * la misma razon que en el servidor. Colombia no tiene horario de verano, y un
 * equipo configurado en otra zona agendaria la cita en el dia equivocado.
 */
export function instanteDeFranja(fecha: string, hora: string): string {
  return new Date(`${fecha}T${hora}:00-05:00`).toISOString()
}

/** El cuerpo que espera `POST /api/turnos/agenda`. */
export function solicitudDeCita(celda: CeldaDeAgenda, paciente: { documento: string; nombre: string }) {
  return {
    documentoPaciente: paciente.documento,
    nombrePaciente: paciente.nombre,
    profesionalId: celda.profesionalId,
    horaCita: instanteDeFranja(celda.fecha, celda.hora),
  }
}

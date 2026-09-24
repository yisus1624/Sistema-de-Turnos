/**
 * Reglas de desactivacion del catalogo compartidas por las dos
 * implementaciones del repositorio: el mismo caso tiene que decirse igual
 * venga de la memoria o de PostgreSQL.
 */

/** Un doctor asignado al consultorio y cuantos pacientes tiene hoy. */
export interface DoctorDelConsultorio {
  nombre: string
  /** En espera hoy, mas los citados hoy que aun no llegan. */
  pacientesHoy: number
}

/**
 * Por que no se puede desactivar un consultorio, o null si se puede.
 *
 * El doctor llama SIEMPRE desde su consultorio asignado (ver
 * `consultorioDelProfesional`). Apagarlo con pacientes suyos hoy le dejaba la
 * fila entera sin poder llamar ("esta desactivado") y sin forma de elegir otro,
 * y su casilla desaparecia del televisor. Se dice cuantos doctores y pacientes
 * afecta y que hacer.
 */
export function motivoQueImpideDesactivarModulo(modulo: string, doctores: DoctorDelConsultorio[]): string | null {
  const afectados = doctores.filter((doctor) => doctor.pacientesHoy > 0)
  if (afectados.length === 0) return null

  const pacientes = afectados.reduce((total, doctor) => total + doctor.pacientesHoy, 0)
  const nombres = afectados.map((doctor) => doctor.nombre).join(', ')
  return `No se puede desactivar ${modulo}: ${afectados.length} doctor(es) asignado(s) ahi (${nombres}) tienen ${pacientes} paciente(s) hoy, y con el consultorio apagado no podrian llamarlos. Asignales otro consultorio en Profesionales y vuelve a intentarlo.`
}

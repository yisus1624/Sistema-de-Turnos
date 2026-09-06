/**
 * Confirma que el turno sobre el que se actua es del mismo profesional que
 * autentico el token. Sin esto, un enlace de un doctor podria repetir o
 * cerrar el turno de otro con solo cambiar el id en la URL.
 */
import { turnoRepository } from './repositorio'
import { AccesoInvalidoError } from './acceso-consultorio'

export async function verificarTurnoDelProfesional(turnoId: string, profesionalId: string): Promise<void> {
  // Consulta directa. Antes se pedia el historico completo del profesional
  // —filtrar y ordenar todos los turnos que existen— para acabar mirando uno
  // solo, y esto corre en cada accion de cada doctor.
  const esDelProfesional = await turnoRepository.turnoEsDelProfesional(turnoId, profesionalId)
  if (!esDelProfesional) throw new AccesoInvalidoError()
}

/**
 * Confirma que el turno sobre el que se actua es del mismo profesional que
 * autentico el token. Sin esto, un enlace de un doctor podria repetir o
 * cerrar el turno de otro con solo cambiar el id en la URL.
 */
import { turnoRepository } from './in-memory-repository'
import { AccesoInvalidoError } from './acceso-consultorio'

export async function verificarTurnoDelProfesional(turnoId: string, profesionalId: string): Promise<void> {
  const historico = await turnoRepository.historico({ profesionalId })
  const esDelProfesional = historico.some((t) => t.id === turnoId)
  if (!esDelProfesional) throw new AccesoInvalidoError()
}

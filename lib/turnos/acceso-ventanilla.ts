/**
 * Confirma que el turno sobre el que actua un operador es SUYO: de una fila
 * compartida y llamado por el.
 *
 * Sin esto, cualquier cuenta con la seccion del operador podia cerrar o
 * repetir por id cualquier turno —tambien el paciente que un doctor tiene
 * adentro— con solo cambiar el id en la direccion.
 */
import { turnoRepository } from './repositorio'

export class TurnoAjenoError extends Error {
  readonly status = 403

  constructor() {
    super('Ese turno no lo llamaste tu desde una ventanilla, asi que no puedes cerrarlo ni repetirlo.')
    this.name = 'TurnoAjenoError'
  }
}

export async function verificarTurnoDeLaVentanilla(turnoId: string, funcionarioId: string): Promise<void> {
  if (!(await turnoRepository.turnoEsDeLaVentanilla(turnoId, funcionarioId))) throw new TurnoAjenoError()
}

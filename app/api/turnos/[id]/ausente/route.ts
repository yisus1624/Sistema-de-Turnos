import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { verificarTurnoDeLaVentanilla } from '@/lib/turnos/acceso-ventanilla'
import { idDeTurnoValido } from '@/lib/validators/turnos'
import { registrarCierre } from '@/lib/turnos/rastro-llamado'
import { EVENTOS } from '@/lib/seguridad/eventos'

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/operador')

    // El id se valida y el turno tiene que ser de ESTE operador (fila
    // compartida, llamado por el): ver `verificarTurnoDeLaVentanilla`.
    const id = idDeTurnoValido((await context.params).id)
    await verificarTurnoDeLaVentanilla(id, session.user.id)
    const { turno, yaAplicada } = await turnoRepository.marcarAusente(id, session.user.id)

    // Dar a alguien por ausente le cuenta como inasistencia: tiene que quedar
    // constancia de quien lo hizo, una sola vez.
    if (!yaAplicada) {
      await registrarCierre(EVENTOS.TURNO_AUSENTE, turno, {
        usuarioId: session.user.id,
        usuarioNombre: session.user.name ?? null,
      })
    }

    return NextResponse.json({ turno, yaAplicada })
  } catch (error) {
    return apiError(error)
  }
}

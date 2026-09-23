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
    // Quien cierra la atencion queda grabado en el turno, no solo quien llamo.
    const { turno, yaAplicada } = await turnoRepository.marcarAtendido(id, session.user.id)

    // Idempotente: el reintento de un "Atendido" cuya respuesta se perdio
    // responde exito y no deja un segundo apunte con otra hora.
    if (!yaAplicada) {
      await registrarCierre(EVENTOS.TURNO_ATENDIDO, turno, {
        usuarioId: session.user.id,
        usuarioNombre: session.user.name ?? null,
      })
    }

    return NextResponse.json({ turno, yaAplicada })
  } catch (error) {
    return apiError(error)
  }
}

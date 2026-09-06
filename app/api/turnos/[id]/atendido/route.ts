import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/operador')

    const { id } = await context.params
    // Quien cierra la atencion queda grabado en el turno, no solo quien llamo.
    const turno = await turnoRepository.marcarAtendido(id, session.user.id)

    registrarEvento({
      tipo: 'TURNO_ATENDIDO',
      exito: true,
      usuarioId: session.user.id,
      identificador: turno.codigo,
    })

    return NextResponse.json({ turno })
  } catch (error) {
    return apiError(error)
  }
}

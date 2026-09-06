import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/operador')

    const { id } = await context.params
    const turno = await turnoRepository.marcarAusente(id, session.user.id)

    // Dar a alguien por ausente le cuenta como inasistencia: tiene que quedar
    // constancia de quien lo hizo.
    registrarEvento({
      tipo: 'TURNO_AUSENTE',
      exito: true,
      usuarioId: session.user.id,
      identificador: turno.codigo,
    })

    return NextResponse.json({ turno })
  } catch (error) {
    return apiError(error)
  }
}

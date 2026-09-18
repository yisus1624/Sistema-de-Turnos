import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarRepeticion } from '@/lib/turnos/rastro-llamado'

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/operador')

    const { id } = await context.params
    const turno = await turnoRepository.repetirLlamado(id)

    await registrarRepeticion(turno, {
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
    })

    return NextResponse.json({ turno })
  } catch (error) {
    return apiError(error)
  }
}

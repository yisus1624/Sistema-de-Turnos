import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSeccion('/operador')

    const { id } = await context.params
    const turno = await turnoRepository.repetirLlamado(id)
    return NextResponse.json({ turno })
  } catch (error) {
    return apiError(error)
  }
}

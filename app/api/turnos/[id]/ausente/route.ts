import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireRol(['OPERADOR', 'ADMINISTRADOR'])

    const { id } = await context.params
    const turno = await turnoRepository.marcarAusente(id)
    return NextResponse.json({ turno })
  } catch (error) {
    return apiError(error)
  }
}

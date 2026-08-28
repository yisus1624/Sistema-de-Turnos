import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireRol(['ADMINISTRADOR', 'OPERADOR'])
    const { id } = await context.params
    const cita = await turnoRepository.cancelarCita(id)
    return NextResponse.json({ cita })
  } catch (error) {
    return apiError(error)
  }
}

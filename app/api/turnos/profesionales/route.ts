import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

export async function GET(request: Request) {
  try {
    await requireRol(['OPERADOR', 'ADMINISTRADOR'])

    const { searchParams } = new URL(request.url)
    const servicioId = searchParams.get('servicioId') ?? undefined
    const profesionales = await turnoRepository.listarProfesionales(servicioId)
    return NextResponse.json({ profesionales })
  } catch (error) {
    return apiError(error)
  }
}

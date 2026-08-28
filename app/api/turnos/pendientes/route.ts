import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

export async function GET(request: Request) {
  try {
    await requireRol(['OPERADOR', 'ADMINISTRADOR'])

    const { searchParams } = new URL(request.url)
    const servicioId = searchParams.get('servicioId') ?? undefined
    const profesionalId = searchParams.get('profesionalId') ?? undefined

    if (!servicioId && !profesionalId) {
      return NextResponse.json({ error: 'Debes indicar el servicio o el profesional.' }, { status: 400 })
    }

    const pendientes = await turnoRepository.listarPendientes({ servicioId, profesionalId })
    return NextResponse.json({ pendientes })
  } catch (error) {
    return apiError(error)
  }
}

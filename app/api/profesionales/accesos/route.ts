import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

export async function GET() {
  try {
    await requireRol(['ADMINISTRADOR'])
    const accesos = await turnoRepository.listarAccesosProfesional()
    return NextResponse.json({ accesos })
  } catch (error) {
    return apiError(error)
  }
}

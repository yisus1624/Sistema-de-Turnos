import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { errorConsultorio, requireProfesionalPorToken } from '@/lib/turnos/acceso-consultorio'
import { verificarTurnoDelProfesional } from '@/lib/turnos/acceso-consultorio-turno'

export async function POST(_request: Request, context: { params: Promise<{ token: string; turnoId: string }> }) {
  try {
    const { token, turnoId } = await context.params
    const profesional = await requireProfesionalPorToken(token)
    await verificarTurnoDelProfesional(turnoId, profesional.id)

    const turno = await turnoRepository.repetirLlamado(turnoId)
    return NextResponse.json({ turno })
  } catch (error) {
    return errorConsultorio(error)
  }
}

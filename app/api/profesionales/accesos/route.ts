import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'

export async function GET() {
  try {
    await requireSeccion('/admin/enlaces')
    const accesos = await turnoRepository.listarAccesosProfesional()
    return NextResponse.json({ accesos })
  } catch (error) {
    return apiError(error)
  }
}

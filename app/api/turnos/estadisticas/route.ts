import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireSeccion } from '@/lib/permissions/session'

/** Fecha de hoy en Colombia, en formato AAAA-MM-DD. */
function hoyEnColombia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

export async function GET(request: Request) {
  try {
    await requireSeccion('/admin/estadisticas')

    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get('fecha') || hoyEnColombia()

    const estadisticas = await turnoRepository.estadisticas(fecha)
    return NextResponse.json({ estadisticas })
  } catch (error) {
    return apiError(error)
  }
}

/**
 * Horario del dia: la parrilla de citas de la jornada de la mañana y la de la
 * tarde, con una columna por doctor.
 *
 * Se arma en el servidor (ver `horarioDelDia` en el repositorio) porque
 * depende de la configuracion del hospital y de la jornada de cada doctor.
 * Lleva nombre y documento de los pacientes, asi que es una ruta CON sesion:
 * nada de esto sale hacia la pantalla de la sala de espera.
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  try {
    await requireSeccion('/admin/citas', '/operador/agenda', '/admin/pruebas')

    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get('fecha') ?? ''
    if (!FECHA.test(fecha)) {
      return NextResponse.json({ error: 'Indica la fecha en formato AAAA-MM-DD.' }, { status: 400 })
    }

    const horario = await turnoRepository.horarioDelDia(fecha)
    return NextResponse.json({ horario })
  } catch (error) {
    return apiError(error)
  }
}

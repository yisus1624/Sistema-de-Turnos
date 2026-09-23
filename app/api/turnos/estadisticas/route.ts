import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion } from '@/lib/seguridad/registro'
import { conFrenoDeConsultaPesada } from '@/lib/seguridad/freno-consultas'
import { diaColombia, esFechaValida } from '@/lib/turnos/tiempo'


export async function GET(request: Request) {
  try {
    const session = await requireSeccion('/admin/estadisticas')

    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get('fecha') || diaColombia(new Date())
    if (!esFechaValida(fecha)) {
      return NextResponse.json({ error: 'La fecha no es valida. Usa el formato AAAA-MM-DD.' }, { status: 400 })
    }

    // Lee el dia entero de turnos y citas: consulta cara, con su freno.
    const { ip } = await contextoPeticion()
    const estadisticas = await conFrenoDeConsultaPesada('estadisticas', { usuarioId: session.user.id, ip }, () =>
      turnoRepository.estadisticas(fecha),
    )
    return NextResponse.json({ estadisticas })
  } catch (error) {
    return apiError(error)
  }
}

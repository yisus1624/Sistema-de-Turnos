/**
 * Que servicios y que consultorios atendieron un dia concreto.
 *
 * Lo consultan las pantallas de Servicios y de Modulos para poder decir, al
 * lado de cada fila, si eso trabajo ese dia. Es el equivalente de
 * `/api/turnos/profesionales/jornadas` para el resto del catalogo, y existe por
 * la misma razon: el campo `activo` dice que algo existe en el hospital, no que
 * hoy este funcionando.
 *
 * No escribe nada: es trazabilidad, y se puede preguntar por cualquier dia que
 * ya este cargado.
 */
import { NextResponse } from 'next/server'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { ahoraISO, diaColombia, esFechaValida } from '@/lib/turnos/tiempo'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireSeccion('/admin/servicios', '/admin/modulos', '/admin/profesionales')

    const pedida = new URL(request.url).searchParams.get('fecha')
    if (pedida && !esFechaValida(pedida)) {
      return NextResponse.json({ error: 'La fecha no es valida.' }, { status: 400 })
    }

    const fecha = pedida ?? diaColombia(ahoraISO())
    return NextResponse.json(await turnoRepository.actividadDelCatalogo(fecha))
  } catch (error) {
    return apiError(error)
  }
}

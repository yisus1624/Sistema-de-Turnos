/**
 * Registro de actividades importantes (requerimiento seccion 17).
 *
 * SE FILTRA EN EL SERVIDOR, NO EN LA PANTALLA. Antes se pedian los ultimos 500
 * eventos y el navegador los filtraba: con eso no se podia preguntar "que paso
 * el martes", que es como se usa un registro de auditoria. Cuando alguien
 * reclama, se sabe el dia; lo que hay que poder hacer es ir a ese dia.
 */
import { NextResponse } from 'next/server'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { listarEventos, tiposDeEvento } from '@/lib/seguridad/registro'
import { esFechaValida } from '@/lib/turnos/tiempo'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireSeccion('/admin/seguridad')

    const { searchParams } = new URL(request.url)

    const fecha = searchParams.get('fecha') ?? undefined
    if (fecha && !esFechaValida(fecha)) {
      return NextResponse.json({ error: 'La fecha no es valida.' }, { status: 400 })
    }

    const limiteCrudo = Number(searchParams.get('limite') ?? 200)

    // Los tipos se piden a la vez y salen de TODO el registro, no de lo que se
    // esta viendo: si no, el selector se queda sin la opcion justo los dias en
    // que esa cosa todavia no ha pasado, que es cuando se la busca.
    const [eventos, tipos] = await Promise.all([
      listarEventos({
        fecha,
        tipo: searchParams.get('tipo') || undefined,
        soloFallidos: searchParams.get('fallidos') === '1',
        limite: Number.isFinite(limiteCrudo) ? limiteCrudo : 200,
      }),
      tiposDeEvento(),
    ])

    return NextResponse.json({ eventos, tipos })
  } catch (error) {
    return apiError(error)
  }
}

/**
 * Registro de actividades importantes (requerimiento seccion 17).
 *
 * El registro se escribia desde hace tiempo, pero `listarEventos` no la
 * llamaba nadie: no habia ni una ruta ni una pantalla que lo mostrara, asi que
 * en la practica era un `console.warn` con pasos de mas. Una bitacora que no se
 * puede leer no es una bitacora.
 */
import { NextResponse } from 'next/server'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { listarEventos } from '@/lib/seguridad/registro'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireSeccion('/admin/seguridad')

    const { searchParams } = new URL(request.url)
    const limite = Number(searchParams.get('limite') ?? 200)
    const eventos = listarEventos(Number.isFinite(limite) ? Math.min(Math.max(limite, 1), 1000) : 200)

    return NextResponse.json({ eventos })
  } catch (error) {
    return apiError(error)
  }
}

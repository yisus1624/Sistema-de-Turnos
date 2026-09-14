/**
 * Recalcula la jornada de los doctores a partir de las citas ya cargadas.
 *
 * La carga diaria ya lo hace con los dias que trae el archivo. Esto es para lo
 * que quedo cargado ANTES de que existiera esa regla, que es como esta hoy el
 * hospital: catorce doctores con "dia completo" porque el reporte no dice en
 * que jornada trabajan. Se dispara a mano desde Profesionales.
 *
 * Es idempotente: correrlo dos veces no cambia nada la segunda.
 */
import { NextResponse } from 'next/server'
import { recalcularJornadas } from '@/lib/citas/jornadas'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { apiError, requireSeccion } from '@/lib/permissions/session'

export async function POST() {
  try {
    const session = await requireSeccion('/admin/profesionales')

    const ajustes = await recalcularJornadas()

    // Cambiarle la jornada a un doctor cambia en que parte de la parrilla sale
    // y a que horas se le puede agendar. Tiene que quedar quien lo pidio.
    const { ip } = await contextoPeticion()
    registrarEvento({
      tipo: 'profesionales.jornadas.recalculadas',
      exito: true,
      usuarioId: session.user.id,
      ip,
      detalle: { ajustes: ajustes.map((a) => `${a.nombre}: ${a.jornada}`) },
    })

    return NextResponse.json({ ajustes })
  } catch (error) {
    return apiError(error)
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'

const cambioSchema = z.object({
  nombre: z.string().trim().min(3).max(60).optional(),
  servicioId: z.string().trim().nullable().optional(),
  activo: z.boolean().optional(),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/admin/modulos')

    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = cambioSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const modulo = await turnoRepository.actualizarModulo(id, parsed.data)

    // Apagar un consultorio lo quita de la pantalla de la sala de espera, que es
    // por donde el paciente sabe a que puerta entrar. Queda escrito quien lo
    // hizo.
    const { ip } = await contextoPeticion()
    await registrarEvento({
      tipo: EVENTOS.MODULO_ACTUALIZADO,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: modulo.nombre,
      ip,
      detalle:
        parsed.data.activo === undefined
          ? parsed.data
          : { ...parsed.data, estado: parsed.data.activo ? 'activado' : 'desactivado' },
    })

    return NextResponse.json({ modulo })
  } catch (error) {
    return apiError(error)
  }
}

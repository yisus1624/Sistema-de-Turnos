import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'

const cambioSchema = z.object({
  nombre: z.string().trim().min(3).max(60).optional(),
  prefijo: z
    .string()
    .trim()
    .min(1)
    .max(3)
    .regex(/^[A-Za-z]+$/, 'El prefijo solo admite letras.')
    .optional(),
  modoFila: z.enum(['COMPARTIDA', 'POR_PROFESIONAL']).optional(),
  activo: z.boolean().optional(),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSeccion('/admin/servicios')

    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = cambioSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const servicio = await turnoRepository.actualizarServicio(id, parsed.data)
    return NextResponse.json({ servicio })
  } catch (error) {
    return apiError(error)
  }
}

/**
 * Borra un servicio del catalogo.
 *
 * El repositorio solo lo permite si el servicio nunca llego a operar (sin
 * turnos, citas ni profesionales); si ya opero, devuelve un mensaje que
 * explica que hay que desactivarlo en vez de borrarlo, para no dejar el
 * historico apuntando a un servicio que ya no existe.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSeccion('/admin/servicios')

    const { id } = await context.params
    await turnoRepository.eliminarServicio(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

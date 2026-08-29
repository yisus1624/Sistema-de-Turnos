import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireSeccion } from '@/lib/permissions/session'

const cambioSchema = z.object({
  nombre: z.string().trim().min(3).max(60).optional(),
  servicioId: z.string().trim().nullable().optional(),
  activo: z.boolean().optional(),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSeccion('/admin/modulos')

    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = cambioSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const modulo = await turnoRepository.actualizarModulo(id, parsed.data)
    return NextResponse.json({ modulo })
  } catch (error) {
    return apiError(error)
  }
}

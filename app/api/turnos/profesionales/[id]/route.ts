import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'

const cambioSchema = z.object({
  nombre: z.string().trim().min(3, 'Ingresa el nombre del profesional.').max(80).optional(),
  servicioId: z.string().min(1).optional(),
  jornada: z.enum(['MANANA', 'TARDE', 'COMPLETA']).optional(),
  moduloId: z.string().nullable().optional(),
  activo: z.boolean().optional(),
})

/**
 * Edita un doctor. No hay DELETE a proposito: un profesional se desactiva
 * (`activo: false`), porque su nombre aparece en el historico de los turnos
 * que ya llamo y borrarlo dejaria ese rastro huerfano.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSeccion('/admin/profesionales')

    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = cambioSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const profesional = await turnoRepository.actualizarProfesional(id, parsed.data)
    return NextResponse.json({ profesional })
  } catch (error) {
    return apiError(error)
  }
}

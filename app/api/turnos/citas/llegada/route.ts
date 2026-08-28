import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

const bodySchema = z.object({
  citaId: z.string().min(1, 'Debes indicar la cita.'),
})

export async function POST(request: Request) {
  try {
    await requireRol(['OPERADOR', 'ADMINISTRADOR'])

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const turno = await turnoRepository.registrarLlegada(parsed.data.citaId)
    return NextResponse.json({ turno })
  } catch (error) {
    return apiError(error)
  }
}

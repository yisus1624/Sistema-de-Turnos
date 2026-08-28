import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { errorConsultorio, requireProfesionalPorToken } from '@/lib/turnos/acceso-consultorio'

const bodySchema = z.object({
  moduloId: z.string().min(1, 'Debes indicar el consultorio.'),
})

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params
    const profesional = await requireProfesionalPorToken(token)

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const turno = await turnoRepository.llamarSiguiente({
      profesionalId: profesional.id,
      moduloId: parsed.data.moduloId,
      // No hay usuario de sistema: el propio profesional queda como quien llamo.
      funcionarioId: profesional.id,
    })

    if (!turno) {
      return NextResponse.json({ error: 'No hay pacientes en espera.' }, { status: 404 })
    }

    return NextResponse.json({ turno })
  } catch (error) {
    return errorConsultorio(error)
  }
}

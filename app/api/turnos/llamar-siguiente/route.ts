import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

const bodySchema = z
  .object({
    servicioId: z.string().min(1).optional(),
    profesionalId: z.string().min(1).optional(),
    moduloId: z.string().min(1, 'Debes indicar el consultorio o la ventanilla.'),
  })
  .refine((datos) => datos.servicioId || datos.profesionalId, {
    message: 'Debes indicar el servicio o el profesional.',
  })

export async function POST(request: Request) {
  try {
    // El funcionario que llama sale de la sesion, no del cuerpo de la peticion:
    // queda registrado en el historico (requerimiento seccion 23).
    const session = await requireRol(['OPERADOR', 'ADMINISTRADOR'])

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const turno = await turnoRepository.llamarSiguiente({
      ...parsed.data,
      funcionarioId: session.user.id,
    })

    if (!turno) {
      return NextResponse.json({ error: 'No hay pacientes en espera.' }, { status: 404 })
    }

    return NextResponse.json({ turno })
  } catch (error) {
    return apiError(error)
  }
}

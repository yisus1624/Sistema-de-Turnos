import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

export async function GET() {
  try {
    await requireRol(['ADMINISTRADOR'])
    const configuracion = await turnoRepository.configuracion()
    return NextResponse.json({ configuracion })
  } catch (error) {
    return apiError(error)
  }
}

const configuracionSchema = z.object({
  audioActivo: z.boolean().optional(),
  repeticionesAudio: z.number().int().min(1).max(3).optional(),
  volumen: z.number().min(0).max(1).optional(),
  ultimosVisibles: z.number().int().min(3).max(10).optional(),
  mensajePie: z.string().trim().max(200).optional(),
})

export async function PUT(request: Request) {
  try {
    await requireRol(['ADMINISTRADOR'])

    const body = await request.json().catch(() => null)
    const parsed = configuracionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const configuracion = await turnoRepository.guardarConfiguracion(parsed.data)
    return NextResponse.json({ configuracion })
  } catch (error) {
    return apiError(error)
  }
}

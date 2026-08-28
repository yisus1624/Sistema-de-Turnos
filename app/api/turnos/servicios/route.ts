import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

// Publico a proposito: la pantalla de la sala de espera agrupa por servicio.
export async function GET() {
  const servicios = await turnoRepository.listarServicios()
  return NextResponse.json({ servicios })
}

const servicioSchema = z.object({
  nombre: z.string().trim().min(3, 'El nombre debe tener al menos 3 caracteres.').max(60),
  prefijo: z
    .string()
    .trim()
    .min(1, 'El prefijo es obligatorio.')
    .max(3, 'El prefijo no puede pasar de 3 letras.')
    .regex(/^[A-Za-z]+$/, 'El prefijo solo admite letras.'),
  modoFila: z.enum(['COMPARTIDA', 'POR_PROFESIONAL']),
  activo: z.boolean().default(true),
})

export async function POST(request: Request) {
  try {
    await requireRol(['ADMINISTRADOR'])

    const body = await request.json().catch(() => null)
    const parsed = servicioSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const servicio = await turnoRepository.crearServicio(parsed.data)
    return NextResponse.json({ servicio })
  } catch (error) {
    return apiError(error)
  }
}

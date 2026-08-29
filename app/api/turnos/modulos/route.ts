import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol, requireSeccion } from '@/lib/permissions/session'

export async function GET(request: Request) {
  try {
    await requireRol(['OPERADOR', 'ADMINISTRADOR'])

    const { searchParams } = new URL(request.url)
    const servicioId = searchParams.get('servicioId') ?? undefined
    const modulos = await turnoRepository.listarModulos(servicioId)
    return NextResponse.json({ modulos })
  } catch (error) {
    return apiError(error)
  }
}

const moduloSchema = z.object({
  nombre: z.string().trim().min(3, 'El nombre debe tener al menos 3 caracteres.').max(60),
  servicioId: z.string().trim().nullable().optional(),
  activo: z.boolean().default(true),
})

export async function POST(request: Request) {
  try {
    await requireSeccion('/admin/modulos')

    const body = await request.json().catch(() => null)
    const parsed = moduloSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const modulo = await turnoRepository.crearModulo({
      nombre: parsed.data.nombre,
      servicioId: parsed.data.servicioId || null,
      activo: parsed.data.activo,
    })
    return NextResponse.json({ modulo })
  } catch (error) {
    return apiError(error)
  }
}

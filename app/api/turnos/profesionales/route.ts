/**
 * Catalogo de profesionales (doctores).
 *
 * TEMPORAL: cuando llegue la API del hospital, los profesionales vendran de
 * alla y esta alta manual sobra. Mientras tanto el administrador los crea aqui
 * para poder agendarles citas.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireRol, requireSeccion, tieneSeccion } from '@/lib/permissions/session'

export async function GET(request: Request) {
  try {
    // La lista la consultan varias pantallas (agenda, admisiones,
    // administracion), asi que basta con tener sesion en el sistema.
    const session = await requireRol(['OPERADOR', 'ADMINISTRADOR'])

    const { searchParams } = new URL(request.url)
    const servicioId = searchParams.get('servicioId') ?? undefined

    // Los inactivos solo se le muestran a quien administra el catalogo: en la
    // agenda o en admisiones solo estorbarian, porque no se les puede agendar.
    const incluirInactivos =
      searchParams.get('todos') === '1' && tieneSeccion(session, '/admin/profesionales')

    const profesionales = await turnoRepository.listarProfesionales(servicioId, incluirInactivos)
    return NextResponse.json({ profesionales })
  } catch (error) {
    return apiError(error)
  }
}

const profesionalSchema = z.object({
  nombre: z.string().trim().min(3, 'Ingresa el nombre del profesional.').max(80),
  servicioId: z.string().min(1, 'Selecciona el servicio.'),
  jornada: z.enum(['MANANA', 'TARDE', 'COMPLETA']),
  moduloId: z.string().nullable().optional(),
})

export async function POST(request: Request) {
  try {
    await requireSeccion('/admin/profesionales')

    const body = await request.json().catch(() => null)
    const parsed = profesionalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const profesional = await turnoRepository.crearProfesional(parsed.data)
    return NextResponse.json({ profesional })
  } catch (error) {
    return apiError(error)
  }
}

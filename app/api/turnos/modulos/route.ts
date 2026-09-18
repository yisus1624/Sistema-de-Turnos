import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireRol, requireSeccion, tieneSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'

export async function GET(request: Request) {
  try {
    const session = await requireRol(['OPERADOR', 'ADMINISTRADOR'])

    const { searchParams } = new URL(request.url)
    const servicioId = searchParams.get('servicioId') ?? undefined

    // Los inactivos solo para quien administra el catalogo, que es el unico
    // que los necesita: sin esto, desactivar un consultorio lo desaparecia de
    // la unica lista donde se podia volver a activar.
    const incluirInactivos =
      searchParams.get('todos') === '1' &&
      tieneSeccion(session, '/admin/modulos', '/admin/profesionales')

    const modulos = await turnoRepository.listarModulos(servicioId, incluirInactivos)
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
    const session = await requireSeccion('/admin/modulos')

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

    const { ip } = await contextoPeticion()
    await registrarEvento({
      tipo: EVENTOS.MODULO_CREADO,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: modulo.nombre,
      ip,
    })

    return NextResponse.json({ modulo })
  } catch (error) {
    return apiError(error)
  }
}

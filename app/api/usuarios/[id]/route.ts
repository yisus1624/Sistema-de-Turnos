import { NextResponse } from 'next/server'
import { z } from 'zod'
import { usuarioRepository } from '@/lib/usuarios/in-memory-repository'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'

const cambioSchema = z.object({
  nombre: z.string().trim().min(3).max(80).optional(),
  usuario: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'El usuario solo admite letras, numeros, punto, guion y guion bajo.')
    .optional(),
  rol: z.enum(['ADMINISTRADOR', 'OPERADOR']).optional(),
  area: z.string().trim().max(60).nullable().optional(),
  activo: z.boolean().optional(),
  password: z.string().min(8, 'La contrasena debe tener minimo 8 caracteres.').optional(),
  secciones: z.array(z.string()).nullable().optional(),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/admin/usuarios')
    const { id } = await context.params

    const body = await request.json().catch(() => null)
    const parsed = cambioSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    // Nadie puede quitarse a si mismo el acceso: dejaria al sistema sin
    // administrador si es el unico que queda.
    if (id === session.user.id && (parsed.data.activo === false || parsed.data.rol === 'OPERADOR')) {
      return NextResponse.json(
        { error: 'No puedes quitarte a ti mismo el acceso de administrador.' },
        { status: 400 },
      )
    }

    // Solo un administrador reparte roles y permisos. Un operador al que le
    // dieron la seccion de usuarios administra cuentas, pero no puede
    // ascenderse a si mismo ni ampliarse los permisos.
    if (session.user.rol !== 'ADMINISTRADOR') {
      if (parsed.data.rol === 'ADMINISTRADOR') {
        return NextResponse.json(
          { error: 'Solo un administrador puede asignar el rol de administrador.' },
          { status: 403 },
        )
      }
      if (id === session.user.id && (parsed.data.secciones !== undefined || parsed.data.rol !== undefined)) {
        return NextResponse.json(
          { error: 'No puedes cambiar tu propio rol ni tus propios permisos.' },
          { status: 403 },
        )
      }
    }

    if (parsed.data.rol === 'OPERADOR' && parsed.data.secciones && parsed.data.secciones.length === 0) {
      return NextResponse.json({ error: 'Selecciona al menos una seccion para el operador.' }, { status: 400 })
    }

    const usuario = await usuarioRepository.actualizar(id, parsed.data)
    registrarEvento({
      tipo: 'USUARIO_ACTUALIZADO',
      exito: true,
      usuarioId: session.user.id,
      identificador: usuario.usuario,
      detalle: { cambios: Object.keys(parsed.data).filter((clave) => clave !== 'password') },
    })

    return NextResponse.json({ usuario })
  } catch (error) {
    return apiError(error)
  }
}

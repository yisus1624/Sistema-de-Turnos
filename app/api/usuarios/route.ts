import { NextResponse } from 'next/server'
import { z } from 'zod'
import { usuarioRepository } from '@/lib/usuarios/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'

export async function GET() {
  try {
    await requireRol(['ADMINISTRADOR'])
    const usuarios = await usuarioRepository.listar()
    return NextResponse.json({ usuarios })
  } catch (error) {
    return apiError(error)
  }
}

const usuarioSchema = z.object({
  nombre: z.string().trim().min(3, 'Ingresa el nombre completo.').max(80),
  usuario: z
    .string()
    .trim()
    .min(3, 'El usuario debe tener al menos 3 caracteres.')
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'El usuario solo admite letras, numeros, punto, guion y guion bajo.'),
  rol: z.enum(['ADMINISTRADOR', 'OPERADOR']),
  area: z.string().trim().max(60).nullable().optional(),
  password: z.string().min(8, 'La contrasena debe tener minimo 8 caracteres.'),
})

export async function POST(request: Request) {
  try {
    const session = await requireRol(['ADMINISTRADOR'])

    const body = await request.json().catch(() => null)
    const parsed = usuarioSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const usuario = await usuarioRepository.crear(parsed.data)
    registrarEvento({
      tipo: 'USUARIO_CREADO',
      exito: true,
      usuarioId: session.user.id,
      identificador: usuario.usuario,
      detalle: { rol: usuario.rol },
    })

    return NextResponse.json({ usuario })
  } catch (error) {
    return apiError(error)
  }
}

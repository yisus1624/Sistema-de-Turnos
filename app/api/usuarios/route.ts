import { NextResponse } from 'next/server'
import { z } from 'zod'
import { usuarioRepository } from '@/lib/usuarios/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { secciones as catalogoSecciones } from '@/lib/permissions/rutas'
import { revisarAlta } from '@/lib/usuarios/politica-permisos'

export async function GET() {
  try {
    await requireSeccion('/admin/usuarios')
    const usuarios = await usuarioRepository.listar()
    return NextResponse.json({ usuarios })
  } catch (error) {
    return apiError(error)
  }
}

/**
 * Las secciones tienen que existir en el catalogo.
 *
 * Antes era `z.array(z.string())` y entraba cualquier texto: se pudo crear una
 * cuenta con `["/admin/no-existe"]` sin que nadie protestara. No daba acceso a
 * nada —los guardas comparan el href exacto—, pero dejaba permisos basura en la
 * base y, sobre todo, un administrador podia dejar sin acceso a un funcionario
 * por una errata y no enterarse hasta que el otro no pudiera entrar.
 */
const hrefsValidos = catalogoSecciones.map((seccion) => seccion.href)
const seccionesSchema = z
  .array(z.string())
  .refine((lista) => lista.every((href) => hrefsValidos.includes(href)), {
    message: 'Alguna de las secciones indicadas no existe en el sistema.',
  })

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
  secciones: seccionesSchema.nullable().optional(),
})

export async function POST(request: Request) {
  try {
    const session = await requireSeccion('/admin/usuarios')

    const body = await request.json().catch(() => null)
    const parsed = usuarioSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const { ip } = await contextoPeticion()
    const actor = {
      id: session.user.id,
      rol: session.user.rol,
      secciones: session.user.secciones,
    }

    // Quien puede darle que a quien se decide en `politica-permisos`, que es
    // puro y esta probado caso por caso. Aqui solo se aplica el veredicto.
    const rechazo = revisarAlta(actor, parsed.data)
    if (rechazo) {
      // El intento rechazado TAMBIEN se apunta: alguien tratando de crear una
      // cuenta con mas acceso del que tiene es justo lo que hay que poder
      // revisar despues.
      await registrarEvento({
        tipo: EVENTOS.USUARIO_CREADO,
        exito: false,
        usuarioId: session.user.id,
        usuarioNombre: session.user.name ?? null,
        identificador: parsed.data.usuario,
        ip,
        detalle: { motivo: rechazo.motivo, rol: parsed.data.rol },
      })
      return NextResponse.json({ error: rechazo.motivo }, { status: rechazo.estado })
    }

    const usuario = await usuarioRepository.crear(parsed.data)
    await registrarEvento({
      tipo: EVENTOS.USUARIO_CREADO,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: usuario.usuario,
      ip,
      // Con que secciones NACE la cuenta, no solo su rol: es el dato que hace
      // falta para revisar despues si a alguien se le dio de mas.
      detalle: {
        objetivoId: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        secciones: usuario.secciones ?? 'las de su rol',
      },
    })

    return NextResponse.json({ usuario })
  } catch (error) {
    return apiError(error)
  }
}

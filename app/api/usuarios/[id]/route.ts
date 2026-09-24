import { NextResponse } from 'next/server'
import { z } from 'zod'
import { usuarioRepository } from '@/lib/usuarios/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { registrarApuntes, type Firma } from '@/lib/seguridad/apuntar'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { secciones as catalogoSecciones } from '@/lib/permissions/rutas'
import { revisarCambio, revisarQueQuedeUnAdministrador } from '@/lib/usuarios/politica-permisos'
import { apunteDeRenombradoFallido, apuntesDeEdicion } from '@/lib/usuarios/auditoria'
import type { Usuario } from '@/lib/usuarios/types'

/** Ver la nota del POST: las secciones tienen que existir en el catalogo. */
const hrefsValidos = catalogoSecciones.map((seccion) => seccion.href)

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
  password: z
    .string()
    .min(8, 'La contrasena debe tener minimo 8 caracteres.')
    .max(200, 'La contrasena es demasiado larga.')
    .optional(),
  secciones: z
    .array(z.string())
    .refine((lista) => lista.every((href) => hrefsValidos.includes(href)), {
      message: 'Alguna de las secciones indicadas no existe en el sistema.',
    })
    .nullable()
    .optional(),
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

    // La cuenta se lee ENTERA y de la lista completa, no con `buscarPorId`, que
    // oculta las dadas de baja: sin eso, la jugada de reactivar una cuenta y
    // tomarla en la misma peticion se saltaba la comprobacion. Ademas hace
    // falta su estado actual para el registro (el antes y el despues) y para
    // decidir si el actor puede tocarla.
    const usuarios = await usuarioRepository.listar()
    const objetivo = usuarios.find((usuario) => usuario.id === id)
    if (!objetivo) {
      return NextResponse.json({ error: 'El usuario indicado no existe.' }, { status: 404 })
    }

    const { ip } = await contextoPeticion()
    const actor = {
      id: session.user.id,
      rol: session.user.rol,
      secciones: session.user.secciones,
    }

    const rechazo =
      revisarCambio(actor, objetivo, parsed.data) ?? revisarQueQuedeUnAdministrador(objetivo, parsed.data, usuarios)
    if (rechazo) {
      // Un intento de tocar una cuenta que no se puede tocar es justo lo que
      // hay que poder revisar despues, asi que se apunta como fallido.
      await registrarEvento({
        tipo: EVENTOS.USUARIO_ACTUALIZADO,
        exito: false,
        usuarioId: session.user.id,
        usuarioNombre: session.user.name ?? null,
        identificador: objetivo.usuario,
        ip,
        detalle: { motivo: rechazo.motivo, objetivoId: objetivo.id },
      })
      return NextResponse.json({ error: rechazo.motivo }, { status: rechazo.estado })
    }

    const firma: Firma = {
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      ip,
    }

    const usuario = await guardarDejandoRastro(objetivo, parsed.data, firma)

    return NextResponse.json({ usuario })
  } catch (error) {
    return apiError(error)
  }
}

/**
 * Guarda el cambio y deja el rastro, incluso si no se pudo guardar.
 *
 * LA CUENTA SE EDITA, NUNCA SE SUSTITUYE: se actualiza por `id`, asi que
 * renombrarla no le cambia la identidad. Los turnos, los llamados y los
 * eventos historicos siguen apuntando al mismo funcionario; borrarla y crear
 * otra con el nombre nuevo dejaria todo ese historico huerfano.
 *
 * EL FALLO TAMBIEN SE APUNTA. El unico que puede saltar aqui es el nombre de
 * usuario ya tomado, y es de los que hay que poder revisar despues: dos
 * intentos de ponerle a una cuenta el nombre de entrada de otra no son una
 * errata, son alguien probando. Se vuelve a lanzar para que `apiError`
 * responda con el mensaje de negocio tal cual.
 */
async function guardarDejandoRastro(
  objetivo: Usuario,
  datos: z.infer<typeof cambioSchema>,
  firma: Firma,
): Promise<Usuario> {
  let usuario: Usuario
  try {
    usuario = await usuarioRepository.actualizar(objetivo.id, datos)
  } catch (error) {
    if (datos.usuario !== undefined && datos.usuario !== objetivo.usuario) {
      const motivo = error instanceof Error ? error.message : 'no se pudo guardar'
      await registrarApuntes([apunteDeRenombradoFallido(objetivo, datos.usuario, motivo)], firma)
    }
    throw error
  }

  await registrarApuntes(
    apuntesDeEdicion({ antes: objetivo, despues: usuario, passwordCambiada: datos.password !== undefined }),
    firma,
  )

  return usuario
}

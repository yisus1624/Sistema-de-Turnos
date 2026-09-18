import { NextResponse } from 'next/server'
import { z } from 'zod'
import { usuarioRepository } from '@/lib/usuarios/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { secciones as catalogoSecciones } from '@/lib/permissions/rutas'
import { revisarCambio } from '@/lib/usuarios/politica-permisos'

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
  password: z.string().min(8, 'La contrasena debe tener minimo 8 caracteres.').optional(),
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
    const objetivo = (await usuarioRepository.listar()).find((usuario) => usuario.id === id)
    if (!objetivo) {
      return NextResponse.json({ error: 'El usuario indicado no existe.' }, { status: 404 })
    }

    const { ip } = await contextoPeticion()
    const actor = {
      id: session.user.id,
      rol: session.user.rol,
      secciones: session.user.secciones,
    }

    const rechazo = revisarCambio(actor, objetivo, parsed.data)
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

    const usuario = await usuarioRepository.actualizar(id, parsed.data)

    await registrarEvento({
      tipo: EVENTOS.USUARIO_ACTUALIZADO,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: usuario.usuario,
      ip,
      detalle: detalleDelCambio(objetivo, usuario, parsed.data.password !== undefined),
    })

    return NextResponse.json({ usuario })
  } catch (error) {
    return apiError(error)
  }
}

/**
 * Que cambio de verdad, con el antes y el despues.
 *
 * Antes se guardaba `{ cambios: Object.keys(datos) }`, y eso no servia para
 * auditar nada: decia `['secciones']` sin decir de que a que, y el filtro que
 * quitaba la contraseña del detalle se llevaba por delante tambien EL HECHO de
 * que hubiera cambiado. Un restablecimiento de la clave de otro funcionario
 * —la escalada que habia que poder investigar— quedaba escrito como un cambio
 * vacio.
 *
 * La contraseña sigue sin aparecer, ni en claro ni como hash: lo que se apunta
 * es que se cambio.
 */
function detalleDelCambio(
  antes: { rol: string; activo: boolean; secciones?: string[] | null },
  despues: { rol: string; activo: boolean; secciones?: string[] | null },
  passwordCambiada: boolean,
) {
  const detalle: Record<string, unknown> = {}

  if (passwordCambiada) detalle.passwordCambiada = true
  if (antes.rol !== despues.rol) detalle.rol = `${antes.rol} -> ${despues.rol}`
  if (antes.activo !== despues.activo) detalle.estado = despues.activo ? 'activado' : 'desactivado'

  const seccionesAntes = antes.secciones ?? 'las de su rol'
  const seccionesDespues = despues.secciones ?? 'las de su rol'
  if (JSON.stringify(seccionesAntes) !== JSON.stringify(seccionesDespues)) {
    detalle.secciones = { antes: seccionesAntes, despues: seccionesDespues }
  }

  return detalle
}

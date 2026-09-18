import { auth } from '@/lib/auth'
import { puedeVerSeccion } from '@/lib/permissions/rutas'
import type { RolUsuario } from '@/lib/usuarios/types'

export async function requireSession() {
  const session = await auth()
  if (!session?.user?.id) {
    throw Object.assign(new Error('No autorizado'), { status: 401 })
  }
  return session
}

export async function requireRol(roles: RolUsuario[]) {
  const session = await requireSession()
  if (!roles.includes(session.user.rol)) {
    throw Object.assign(new Error('Sin permisos para esta accion'), { status: 403 })
  }
  return session
}

/**
 * Exige acceso a alguna de estas secciones del menu.
 *
 * Se usa en lugar de `requireRol(['ADMINISTRADOR'])` en las APIs de
 * administracion: como el administrador puede darle una seccion suelta a un
 * operador (ver `lib/permissions/rutas.ts`), la API tiene que aceptar al mismo
 * que la UI le deja entrar. Si no, el operador veria la pantalla y cada accion
 * le fallaria con 403.
 */
export async function requireSeccion(...secciones: string[]) {
  const session = await requireSession()
  const permitido = secciones.some((seccion) =>
    puedeVerSeccion(session.user.rol, session.user.secciones, seccion),
  )
  if (!permitido) {
    throw Object.assign(new Error('Sin permisos para esta accion'), { status: 403 })
  }
  return session
}

/** Si el usuario tiene acceso a alguna seccion, sin lanzar error. */
export function tieneSeccion(
  session: { user: { rol: RolUsuario; secciones: string[] | null } },
  ...secciones: string[]
) {
  return secciones.some((seccion) => puedeVerSeccion(session.user.rol, session.user.secciones, seccion))
}

/**
 * La respuesta de error de todas las rutas.
 *
 * SOLO SALE HACIA FUERA EL MENSAJE DE LOS ERRORES QUE LLEVAN `status`.
 *
 * Esos son los que el sistema escribe a proposito para que los lea un
 * funcionario: `ErrorDeNegocio` ("Ya existe ese consultorio", "El profesional
 * esta inactivo") y los de sesion y permisos. Todo lo demas es un fallo
 * inesperado, y su mensaje no esta escrito para nadie: cuando Prisma se queda
 * sin conexion o choca contra un indice, su texto trae nombres de tabla, de
 * columna y a veces el valor que choco, en ingles y con el rastro de la
 * consulta. Eso acababa pintado tal cual en el aviso rojo de la pantalla del
 * mostrador —"No se pudo guardar" seguido de un volcado tecnico—, que no le
 * dice nada a quien lo lee y le cuenta de mas a cualquiera que este delante.
 *
 * El detalle no se pierde: se escribe entero en el registro del servidor, que
 * es donde hay que ir a buscarlo.
 */
export function apiError(error: unknown) {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status: unknown }).status)
      : 500
  const esperado = Number.isFinite(status) && status >= 400 && status < 500

  if (!esperado) {
    console.error('[api] fallo inesperado', error)
    return Response.json(
      {
        error:
          'No se pudo completar la operacion por un problema del sistema. Vuelve a intentarlo; si sigue pasando, avisa a sistemas.',
      },
      { status: 500 },
    )
  }

  const message = error instanceof Error ? error.message : 'Ocurrio un error inesperado.'
  return Response.json({ error: message }, { status })
}

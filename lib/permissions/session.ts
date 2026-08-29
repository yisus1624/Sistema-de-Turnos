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

export function apiError(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: unknown }).status) : 500
  const message = error instanceof Error ? error.message : 'Ocurrio un error inesperado.'
  return Response.json({ error: message }, { status: Number.isFinite(status) ? status : 500 })
}

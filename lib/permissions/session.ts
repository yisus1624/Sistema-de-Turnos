import { auth } from '@/lib/auth'
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

export function apiError(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: unknown }).status) : 500
  const message = error instanceof Error ? error.message : 'Ocurrio un error inesperado.'
  return Response.json({ error: message }, { status: Number.isFinite(status) ? status : 500 })
}

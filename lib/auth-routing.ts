import type { RutaInicialRol } from '@/types/auth'

/** Pantalla inicial de cada rol tras iniciar sesion (requerimiento seccion 6). */
export function rutaInicialPorRol(rol?: string | null): RutaInicialRol | '/auth/login' {
  if (rol === 'ADMINISTRADOR') return '/admin/turnos'
  if (rol === 'OPERADOR') return '/operador'
  return '/auth/login'
}

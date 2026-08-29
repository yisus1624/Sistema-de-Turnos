import type { RutaInicialRol } from '@/types/auth'
import { primeraRutaPermitida } from '@/lib/permissions/rutas'

/** Pantalla inicial de cada rol tras iniciar sesion (requerimiento seccion 6). */
export function rutaInicialPorRol(
  rol?: string | null,
  secciones?: string[] | null,
): RutaInicialRol | '/auth/login' {
  if (rol === 'ADMINISTRADOR') return '/admin/turnos'
  if (rol === 'OPERADOR') return primeraRutaPermitida('OPERADOR', secciones) as RutaInicialRol
  return '/auth/login'
}

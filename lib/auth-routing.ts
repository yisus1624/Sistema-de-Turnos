import type { RutaInicialRol } from '@/types/auth'
import { primeraRutaPermitida } from '@/lib/permissions/rutas'

/**
 * Pantalla inicial de cada rol tras iniciar sesion (requerimiento seccion 6).
 *
 * Sale de `primeraRutaPermitida` para LOS DOS roles, que es el mismo calculo
 * que usa el guarda de las pantallas (`RoleShell`). Antes al administrador se
 * le mandaba fijo a '/admin/turnos' sin mirar sus secciones: si ese
 * administrador no tenia esa seccion, el guarda lo devolvia a su primera ruta
 * permitida y, si no tenia ninguna, a '/auth/login', que vuelve a mandarlo
 * aqui. Un bucle de redirecciones del que no se sale ni cerrando sesion.
 *
 * En el caso normal no cambia nada: un administrador sin secciones recortadas
 * sigue entrando por '/admin/turnos', que es la primera del catalogo.
 */
export function rutaInicialPorRol(
  rol?: string | null,
  secciones?: string[] | null,
): RutaInicialRol | '/auth/login' {
  if (rol === 'ADMINISTRADOR') return primeraRutaPermitida('ADMINISTRADOR', secciones) as RutaInicialRol
  if (rol === 'OPERADOR') return primeraRutaPermitida('OPERADOR', secciones) as RutaInicialRol
  return '/auth/login'
}

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

/** A donde va quien entra sin `volverA` valido: la pantalla de su rol. */
const DESTINO_POR_DEFECTO = '/auth/redirect'

/**
 * A donde volver despues de iniciar sesion, a partir del `volverA` de la URL.
 *
 * `volverA` lo puede escribir cualquiera en un enlace, asi que solo se acepta
 * una ruta del MISMO sitio. Se resuelve como lo hace el navegador (`new URL`
 * contra el origen actual) y se compara el origen: la comprobacion anterior
 * ("empieza por / y no por //") dejaba pasar la barra invertida y el
 * tabulador, que el navegador normaliza a `//otro-sitio` y terminaban
 * llevando al funcionario, con la sesion recien abierta, a un sitio ajeno.
 * Se devuelve solo ruta y consulta, nunca una URL completa.
 *
 * Y LA RUTA RESUELTA TAMPOCO PUEDE EMPEZAR POR DOS BARRAS. Los segmentos con
 * punto (`/.//evil.com`, `/a/..//evil.com`) resuelven al mismo origen pero
 * dejan la ruta en `//evil.com`, y el router de Next la vuelve a resolver
 * contra la pagina actual como una direccion externa.
 */
export function destinoTrasEntrar(volverA: string | null, origen: string): string {
  if (!volverA) return DESTINO_POR_DEFECTO
  try {
    const destino = new URL(volverA, origen)
    if (destino.origin !== origen || empiezaComoOtroSitio(destino.pathname)) return DESTINO_POR_DEFECTO
    return `${destino.pathname}${destino.search}`
  } catch {
    return DESTINO_POR_DEFECTO
  }
}

/** Una ruta que el navegador leeria como "otro sitio": dos barras, o barra y barra invertida. */
function empiezaComoOtroSitio(ruta: string): boolean {
  return ruta.startsWith('//') || ruta.startsWith('/\\')
}

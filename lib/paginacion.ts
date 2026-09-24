/**
 * Paginacion de las tablas de administracion: la cuenta, sin React, para
 * poder probarla. La barra que la pinta esta en `components/ui/Paginacion`.
 */

/** Registros por pagina que se pueden elegir. El primero es el de siempre. */
export const TAMANOS_DE_PAGINA = [10, 20, 50] as const

export interface Pagina<T> {
  visibles: T[]
  /** La pagina que se esta mostrando, ya acotada a las que hay (desde 1). */
  actual: number
  total: number
  /** Posicion (desde 1) del primer y ultimo registro visibles; 0 si no hay. */
  desde: number
  hasta: number
}

/**
 * Los registros de una pagina. La pagina se ACOTA en vez de corregirse con un
 * efecto: al filtrar, un `setPagina` en un efecto pinta primero una tabla
 * vacia y la corrige en el render siguiente, y ese parpadeo se ve.
 */
export function paginar<T>(lista: readonly T[], pagina: number, porPagina: number): Pagina<T> {
  const total = Math.max(1, Math.ceil(lista.length / porPagina))
  const actual = Math.min(Math.max(1, pagina), total)
  const inicio = (actual - 1) * porPagina
  const visibles = lista.slice(inicio, inicio + porPagina)
  return {
    visibles,
    actual,
    total,
    desde: visibles.length ? inicio + 1 : 0,
    hasta: inicio + visibles.length,
  }
}

/**
 * Los botones de numero a mostrar: la primera, la ultima y las vecinas de la
 * actual, con '…' en los huecos. Con 500 eventos de a 10 serian 50 botones,
 * que no caben en la barra ni en un telefono.
 */
export function numerosDePagina(actual: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const cerca = new Set([1, total, actual - 1, actual, actual + 1])
  // En los extremos, completa hasta cinco numeros seguidos para que la barra
  // no cambie de ancho al avanzar.
  if (actual <= 3) [2, 3, 4, 5].forEach((n) => cerca.add(n))
  if (actual >= total - 2) [total - 4, total - 3, total - 2, total - 1].forEach((n) => cerca.add(n))
  const numeros = [...cerca].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const conHuecos: Array<number | '…'> = []
  numeros.forEach((n, i) => {
    if (i > 0 && n - numeros[i - 1] > 1) conHuecos.push('…')
    conHuecos.push(n)
  })
  return conHuecos
}

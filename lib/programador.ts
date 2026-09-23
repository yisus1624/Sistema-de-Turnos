/**
 * Programar una accion para dentro de `ms` y devolver como cancelarla.
 *
 * Se inyecta donde hace falta esperar (la campana de la pantalla, el reintento
 * de las cargas) para que las pruebas puedan mover el tiempo a mano en vez de
 * esperar segundos de verdad. Un solo tipo para todo el sistema.
 */
export type Programador = (accion: () => void, ms: number) => () => void

export const programadorReal: Programador = (accion, ms) => {
  const id = setTimeout(accion, ms)
  return () => clearTimeout(id)
}

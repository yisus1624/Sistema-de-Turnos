/**
 * Nombres de catalogo para resolver turnos viejos.
 *
 * Las pantallas de consulta piden los catalogos ACTIVOS (para sus filtros); un
 * turno de un servicio, consultorio o medico ya desactivado quedaba con "—".
 * Estos nombres de respaldo (solo id y nombre, sin nada mas) completan los que
 * faltan sin pisar los activos.
 */
export type NombreDeCatalogo = { id: string; nombre: string }

export function soloNombres(lista: ReadonlyArray<NombreDeCatalogo>): NombreDeCatalogo[] {
  return lista.map(({ id, nombre }) => ({ id, nombre }))
}

export function conRespaldo(
  activos: ReadonlyArray<NombreDeCatalogo>,
  respaldo: ReadonlyArray<NombreDeCatalogo>,
): NombreDeCatalogo[] {
  const conocidos = new Set(activos.map((x) => x.id))
  return [...activos, ...respaldo.filter((x) => !conocidos.has(x.id))]
}

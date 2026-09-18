/**
 * Traduce los identificadores del catalogo a nombres legibles.
 *
 * El registro de actividad guardaba cuids crudos (`cmh3x...`) donde tenia que
 * decir "Consultorio 3". Un apunte que hay que ir a resolver contra la base
 * para entenderlo no se lee nunca, y si el catalogo cambia despues ya no se
 * puede resolver.
 *
 * Los nombres se copian EN EL MOMENTO de la accion, igual que `usuarioNombre`:
 * lo que se quiere conservar es como se llamaba entonces.
 */
import { turnoRepository } from './repositorio'

export async function nombreDeModulo(moduloId?: string | null): Promise<string | null> {
  if (!moduloId) return null
  const modulos = await turnoRepository.listarModulos(undefined, true)
  return modulos.find((modulo) => modulo.id === moduloId)?.nombre ?? moduloId
}

export async function nombreDeServicio(servicioId?: string | null): Promise<string | null> {
  if (!servicioId) return null
  const servicios = await turnoRepository.listarServicios(true)
  return servicios.find((servicio) => servicio.id === servicioId)?.nombre ?? servicioId
}

export async function nombreDeProfesional(profesionalId?: string | null): Promise<string | null> {
  if (!profesionalId) return null
  const profesionales = await turnoRepository.listarProfesionales(undefined, true)
  return profesionales.find((profesional) => profesional.id === profesionalId)?.nombre ?? profesionalId
}

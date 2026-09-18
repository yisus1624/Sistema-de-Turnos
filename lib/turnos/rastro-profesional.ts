/**
 * La ficha de un doctor como se lee en el registro de actividad.
 *
 * El evento guardaba lo que venia en la peticion: `servicioId` y `moduloId` en
 * crudo. Semanas despues, "le cambiaron el cmh3x... por el cmh7k..." no lo
 * entiende nadie, y si el consultorio se renombro tampoco se puede resolver.
 * Aqui los identificadores se cambian por los nombres del momento.
 */
import { turnoRepository } from './repositorio'
import { nombreDeModulo, nombreDeServicio } from './catalogo-nombres'
import type { Profesional } from './types'

/** Los mismos campos en el antes y en el despues, para poder compararlos. */
export interface FichaLegible extends Record<string, unknown> {
  nombre: string
  servicio: string | null
  consultorio: string | null
  jornada: string
  estado: 'activo' | 'inactivo'
}

export async function fichaLegible(profesional: Profesional): Promise<FichaLegible> {
  const [servicio, consultorio] = await Promise.all([
    nombreDeServicio(profesional.servicioId),
    nombreDeModulo(profesional.moduloId),
  ])

  return {
    nombre: profesional.nombre,
    servicio,
    consultorio,
    jornada: profesional.jornada,
    estado: profesional.activo ? 'activo' : 'inactivo',
  }
}

/**
 * La ficha de quien esta a punto de cambiar. Va vacia si el doctor no existe:
 * quien decide que hacer con eso es el repositorio, no el registro.
 */
export async function fichaLegiblePorId(id: string): Promise<Partial<FichaLegible>> {
  const profesionales = await turnoRepository.listarProfesionales(undefined, true)
  const profesional = profesionales.find((candidato) => candidato.id === id)
  return profesional ? fichaLegible(profesional) : {}
}

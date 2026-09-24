/**
 * Cortar los enlaces de consultorio vigentes de un doctor.
 *
 * Desactivar al doctor no basta: el enlace sigue valido en la base, y si se le
 * reactiva antes de que venza, la llave vieja vuelve a abrir el consultorio.
 */
import type { TurnoRepository } from './repository'
import type { AccesoProfesional } from './types'

type AccesosDeProfesional = Pick<TurnoRepository, 'listarAccesosProfesional' | 'revocarAccesoProfesional'>

function estaVigente(acceso: AccesoProfesional, ahora: Date) {
  return acceso.revocadoEn === null && new Date(acceso.expiraEn) > ahora
}

export async function revocarAccesosVigentesDe(
  repositorio: AccesosDeProfesional,
  profesionalId: string,
  ahora: Date,
): Promise<AccesoProfesional[]> {
  const accesos = await repositorio.listarAccesosProfesional()
  const vigentes = accesos.filter((acceso) => acceso.profesionalId === profesionalId && estaVigente(acceso, ahora))
  return Promise.all(vigentes.map((acceso) => repositorio.revocarAccesoProfesional(acceso.id)))
}

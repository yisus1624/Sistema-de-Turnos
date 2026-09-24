/**
 * Lo que la pantalla del doctor calcula para mostrarse, sin React, para poder
 * probarlo: iniciales del avatar, el documento legible, el resumen del dia y
 * como contar lo que va a hacer "Retroceder".
 */
import type { ItemAgendaProfesional, Turno } from '@/lib/turnos/types'
import type { PlanDeRetroceso } from '@/lib/turnos/reglas-retroceso'

/** "Ana Maria Ortega Ruiz" -> "AO": nombre y primer apellido. */
export function iniciales(nombre?: string | null): string {
  const palabras = (nombre ?? '').trim().split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return '—'
  const segunda = palabras.length >= 3 ? palabras[palabras.length - 2] : palabras[1]
  return (palabras[0][0] + (segunda?.[0] ?? '')).toLocaleUpperCase('es-CO')
}

/** "1102834567" -> "1.102.834.567". Lo que no son solo cifras se deja igual. */
export function documentoLegible(documento?: string | null): string | null {
  const limpio = documento?.trim()
  if (!limpio) return null
  return /^\d+$/.test(limpio) ? Number(limpio).toLocaleString('es-CO') : limpio
}

export interface ResumenDelDia {
  enEspera: number
  atendidos: number
  /** No se presentaron. */
  ausentes: number
  /** Citas que todavia no registran su llegada en admisiones. */
  sinLlegar: number
  total: number
}

export function resumenDelDia(agenda: readonly ItemAgendaProfesional[]): ResumenDelDia {
  const contar = (estado: ItemAgendaProfesional['estado']) => agenda.filter((i) => i.estado === estado).length
  return {
    enEspera: contar('EN_ESPERA'),
    atendidos: contar('ATENDIDA'),
    ausentes: contar('AUSENTE'),
    sinLlegar: contar('PROGRAMADA'),
    total: agenda.length,
  }
}

/** Lo que se le deshace al paciente que vuelve a atencion, dicho como lo vio el doctor. */
export function queSeDeshace(restaurar: Turno, hayAbierto: boolean): string {
  if (hayAbierto) return 'Se cerro solo al llamar al siguiente. Vuelve a atencion y a la pantalla de la sala.'
  if (restaurar.estado === 'AUSENTE') return 'Se deshace "No se presento". Vuelve a atencion y a la pantalla de la sala.'
  return 'Se deshace "Atendido". Vuelve a atencion y a la pantalla de la sala.'
}

/** El texto corto del boton, para que el doctor sepa a quien recupera antes de abrir nada. */
export function etiquetaDeRetroceso(plan: PlanDeRetroceso | null): string | null {
  if (!plan) return null
  if (plan.restaurar) return `Volver a ${plan.restaurar.codigo}`
  return plan.devolver ? `Devolver ${plan.devolver.codigo} a la fila` : null
}

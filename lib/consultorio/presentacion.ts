/**
 * Lo que la pantalla del doctor calcula para mostrarse, sin React, para poder
 * probarlo: iniciales del avatar, el documento legible, el resumen del dia,
 * como contar lo que va a hacer "Retroceder" y si cambio el doctor.
 */
import type { ItemAgendaProfesional, Profesional, Turno } from '@/lib/turnos/types'
import type { PlanDeRetroceso } from '@/lib/turnos/reglas-retroceso'

/** De quien a quien paso la pantalla (ver `cambioDeDoctor`). */
export interface CambioDeDoctor {
  antes: string
  ahora: string
}

type DoctorEnPantalla = Pick<Profesional, 'id' | 'nombre'>

/**
 * Si al recargar la pantalla pasa a ser de OTRO doctor, o null.
 *
 * Hay una sola cookie de consultorio por navegador: abrir en el mismo PC el
 * enlace de otro doctor la cambia, y la pestaña que ya estaba abierta cargaba
 * sus pacientes sin avisar. El doctor que seguia ahi veia pacientes ajenos como
 * si fueran suyos y podia cerrarle a otro el que tenia adentro. La primera
 * carga no es un cambio, ni lo es el mismo doctor con otro nombre.
 */
export function cambioDeDoctor(visto: DoctorEnPantalla | null, recibido: DoctorEnPantalla): CambioDeDoctor | null {
  if (!visto || visto.id === recibido.id) return null
  return { antes: visto.nombre, ahora: recibido.nombre }
}

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

/** Desde cuantos minutos antes de vencer se le avisa al doctor. */
export const MINUTOS_DE_AVISO_DE_VENCIMIENTO = 30

/**
 * Minutos que le quedan al enlace, solo si ya toca avisar; `null` si falta
 * mas o no se sabe (un servidor viejo que no manda `expiraEn`).
 */
export function minutosParaVencer(expiraEn: string | null | undefined, ahora: number): number | null {
  if (!expiraEn) return null
  const minutos = Math.max(0, Math.ceil((new Date(expiraEn).getTime() - ahora) / 60000))
  return minutos <= MINUTOS_DE_AVISO_DE_VENCIMIENTO ? minutos : null
}

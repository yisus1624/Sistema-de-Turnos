/**
 * Retroceder al turno anterior: la regla, sin base de datos, para probarla.
 *
 * El doctor se equivoca. Pulsa "Siguiente" dos veces, o lo pulsa con el
 * paciente todavia adentro, o marca "Atendido" o "No se presento" sin querer.
 * Retroceder deshace EXACTAMENTE la ultima accion, y se puede pulsar otra vez
 * para ir un paso mas atras:
 *
 *   - Tenia abierto a C, que llamo con "Siguiente", y ese llamado cerro solo a
 *     B: C vuelve a la fila de espera (a su mismo puesto) y B vuelve a quedar
 *     en atencion, en el televisor otra vez.
 *   - Tenia abierto a C y B lo habia cerrado el doctor a mano: C vuelve a la
 *     fila y nada mas. B se cerro por decision propia, no por el llamado.
 *   - No tiene a nadie abierto (acaba de pulsar "Atendido" o "No se presento"
 *     sobre B): B vuelve a quedar en atencion.
 *
 * Solo pacientes del MISMO DIA y de ESE doctor: la consulta ya viene filtrada.
 */
import { ConflictoDeTurno, errorDeNegocio } from './errores'
import type { Turno } from './types'

/** Lo que va a hacer el retroceso. Al menos uno de los dos viene lleno. */
export interface PlanDeRetroceso {
  /** El paciente abierto que vuelve a la fila de espera, o null. */
  devolver: Turno | null
  /** El paciente anterior que vuelve a quedar en atencion, o null. */
  restaurar: Turno | null
}

/**
 * Holgura entre el llamado de C y el cierre automatico de B. Los dos pasan en
 * la misma transaccion, con milisegundos de diferencia; el margen solo cubre
 * relojes y redondeos.
 */
const MS_HOLGURA_DEL_CIERRE = 10_000

/**
 * Si el cierre de `anterior` lo provoco el llamado de `abierto`: fue
 * automatico y paso cuando se llamo a `abierto`.
 */
function loCerroEseLlamado(anterior: Turno, abierto: Turno): boolean {
  if (!anterior.cierreAutomatico || !anterior.cerradoEn || !abierto.horaPrimerLlamado) return false
  return Date.parse(anterior.cerradoEn) >= Date.parse(abierto.horaPrimerLlamado) - MS_HOLGURA_DEL_CIERRE
}

/**
 * El plan, o null si no hay nada que retroceder.
 *
 * `abierto` es el paciente que el doctor tiene en atencion (LLAMADO o
 * EN_ATENCION); `ultimoCerrado`, el ultimo que se cerro (ATENDIDO o AUSENTE),
 * el de `cerradoEn` mas reciente.
 */
export function planDeRetroceso(abierto: Turno | null, ultimoCerrado: Turno | null): PlanDeRetroceso | null {
  if (abierto) {
    const restaurar = ultimoCerrado && loCerroEseLlamado(ultimoCerrado, abierto) ? ultimoCerrado : null
    return { devolver: abierto, restaurar }
  }
  return ultimoCerrado ? { devolver: null, restaurar: ultimoCerrado } : null
}

/**
 * Exige que el plan real sea el que el doctor vio en su pantalla.
 *
 * Es lo que hace seguro el doble clic: el primer retroceso devuelve a C y
 * restaura a B; el segundo llega diciendo "yo veia a C abierto", encuentra a B,
 * y responde 409 con el estado real en vez de retroceder otro paso que el
 * doctor no pidio. Lo mismo si en medio otro equipo cambio algo.
 */
export function exigirPlanVisto(
  plan: PlanDeRetroceso | null,
  visto: { turnoAbiertoId: string | null; restaurarId: string | null },
): PlanDeRetroceso {
  if (!plan) errorDeNegocio('No hay ningun paciente para retroceder hoy.')

  const abiertoReal = plan.devolver?.id ?? null
  const restaurarReal = plan.restaurar?.id ?? null
  if (abiertoReal !== visto.turnoAbiertoId || restaurarReal !== visto.restaurarId) {
    throw new ConflictoDeTurno(
      'Tu pantalla no estaba al dia: ya se actualizo. Revisa quien tienes en atencion antes de retroceder.',
      plan.devolver ?? null,
    )
  }
  return plan
}

/** Los cambios del paciente que vuelve a la fila: como si no lo hubieran llamado. */
export const DEVUELTO_A_LA_FILA = {
  estado: 'EN_ESPERA',
  moduloId: null,
  funcionarioId: null,
  horaLlamado: null,
  // La espera se mide contra el primer llamado: si el llamado fue un error, el
  // paciente sigue esperando, y su espera se medira contra el llamado real.
  horaPrimerLlamado: null,
  vecesLlamado: 0,
} as const

/** Los cambios del paciente que vuelve a quedar en atencion: se deshace su cierre. */
export const REABIERTO = {
  estado: 'LLAMADO',
  cerradoEn: null,
  cerradoPor: null,
  cierreAutomatico: false,
  horaAtencion: null,
} as const

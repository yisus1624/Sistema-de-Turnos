/**
 * Que impide cancelar o mover una cita, segun el estado en que se la encuentre.
 *
 * VIVE APARTE DE LOS REPOSITORIOS POR DOS MOTIVOS.
 *
 * 1. Es la misma regla en memoria y en PostgreSQL, y estaba escrita dos veces
 *    con los mismos textos copiados. Un dia se corrige uno y el funcionario
 *    recibe un aviso distinto segun donde corra el sistema.
 *
 * 2. Contra la base de datos la pregunta se hace DOS veces: una antes de
 *    escribir, para avisar bien, y otra despues de que la escritura
 *    condicionada no afecte a ninguna fila, que es como se detecta que alguien
 *    cambio el estado de la cita mientras el operador tenia el detalle abierto.
 *    La respuesta tiene que ser identica en ambos sitios.
 *
 * Devuelve el aviso para el funcionario, o `null` si la operacion se puede
 * hacer. Se usa una tabla por estado y no un `switch`: al aparecer un estado
 * nuevo de cita se agrega una linea aqui y ningun `if` de los repositorios
 * cambia.
 */
import type { EstadoCita } from './types'

type AvisosPorEstado = Partial<Record<EstadoCita, string>>

const IMPIDEN_CANCELAR: AvisosPorEstado = {
  // Si el paciente ya llego, cancelarla dejaria un turno huerfano en la fila:
  // el paciente sentado en la sala con su turno EN_ESPERA y la cita marcada
  // como cancelada, fuera de la parrilla y contada como inasistencia.
  PRESENTADO: 'El paciente ya registro su llegada; no se puede cancelar.',
  CANCELADA: 'Esta cita ya estaba cancelada.',
  ATENDIDA: 'Esta cita ya fue atendida; no se puede cancelar.',
}

const IMPIDEN_REPROGRAMAR: AvisosPorEstado = {
  // El paciente ya llego y su cita genero turno: moverla dejaria el turno
  // colgado de una hora que ya no existe. Vale tambien cuando el turno se
  // cerro como AUSENTE, porque sigue apuntando a esta cita en el historico.
  PRESENTADO:
    'Este paciente ya registro su llegada y su cita genero turno, asi que no se puede mover. Agendale una cita nueva.',
  CANCELADA: 'La cita fue cancelada; no se puede reprogramar.',
  ATENDIDA: 'La cita ya fue atendida; no se puede reprogramar.',
}

export function motivoQueImpideCancelar(estado: EstadoCita): string | null {
  return IMPIDEN_CANCELAR[estado] ?? null
}

export function motivoQueImpideReprogramar(estado: EstadoCita): string | null {
  return IMPIDEN_REPROGRAMAR[estado] ?? null
}

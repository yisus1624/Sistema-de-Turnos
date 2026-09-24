/**
 * Una fila del reporte de turnos, ya con los nombres resueltos. La usan la
 * tabla de la pantalla y el PDF: las dos dicen exactamente lo mismo.
 *
 * El reporte es sobre PACIENTES: a quien se atendio, con que medico y a que
 * hora. El codigo del turno va al final, como referencia: por si solo no le
 * dice nada a quien lee el reporte.
 */
import { diaColombia } from '@/lib/turnos/tiempo'
import type { Turno } from '@/lib/turnos/types'

export interface FilaReporte {
  turno: Turno
  /** AAAA-MM-DD en Colombia: el dia del turno (un reporte puede abarcar varios). */
  fecha: string
  paciente: string
  /** "CC 1234567", o "—" si el turno no vino de una cita. */
  documento: string
  medico: string
  servicio: string
  consultorio: string
  procedimiento: string
}

type Catalogo = ReadonlyArray<{ id: string; nombre: string }>

const nombre = (lista: Catalogo, id?: string | null) => (id ? (lista.find((x) => x.id === id)?.nombre ?? '—') : '—')

export function filaDeReporte(
  turno: Turno,
  catalogos: { servicios: Catalogo; modulos: Catalogo; profesionales: Catalogo },
): FilaReporte {
  const documento = turno.documentoPaciente
    ? [turno.tipoDocumento, turno.documentoPaciente].filter(Boolean).join(' ')
    : '—'
  return {
    turno,
    fecha: diaColombia(turno.fechaGeneracion),
    paciente: turno.nombrePaciente?.trim() || 'Sin nombre (turno de ventanilla)',
    documento,
    medico: nombre(catalogos.profesionales, turno.profesionalId),
    servicio: nombre(catalogos.servicios, turno.servicioId),
    // El consultorio se asigna al LLAMAR: sin el, el turno nunca se llamo.
    consultorio: turno.moduloId ? nombre(catalogos.modulos, turno.moduloId) : 'Sin llamar',
    procedimiento: turno.procedimiento?.trim() || '—',
  }
}

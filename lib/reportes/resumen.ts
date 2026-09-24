/**
 * Lo que la pantalla de Reportes resume de una lista de turnos, y los
 * periodos rapidos del filtro. Puro, para poder probarlo.
 */
import type { EstadoTurno, Turno } from '@/lib/turnos/types'

export interface ResumenDeTurnos {
  total: number
  atendidos: number
  ausentes: number
  /** Minutos de espera promedio (de la llegada al primer llamado), o null si nadie fue llamado. */
  esperaPromedioMin: number | null
  porEstado: Record<EstadoTurno, number>
}

const ESTADOS_EN_CERO: Record<EstadoTurno, number> = {
  EN_ESPERA: 0,
  LLAMADO: 0,
  EN_ATENCION: 0,
  ATENDIDO: 0,
  AUSENTE: 0,
  CANCELADO: 0,
}

export function resumirTurnos(turnos: Turno[]): ResumenDeTurnos {
  const porEstado = { ...ESTADOS_EN_CERO }
  let esperaTotalMs = 0
  let conEspera = 0
  for (const turno of turnos) {
    porEstado[turno.estado] += 1
    // La espera se mide contra el PRIMER llamado (repetir no la alarga), igual
    // que en Estadisticas.
    const llamado = turno.horaPrimerLlamado ?? turno.horaLlamado
    if (!llamado) continue
    const ms = Date.parse(llamado) - Date.parse(turno.fechaGeneracion)
    if (Number.isFinite(ms) && ms >= 0) {
      esperaTotalMs += ms
      conEspera += 1
    }
  }
  return {
    total: turnos.length,
    atendidos: porEstado.ATENDIDO,
    ausentes: porEstado.AUSENTE,
    esperaPromedioMin: conEspera > 0 ? Math.round(esperaTotalMs / conEspera / 60_000) : null,
    porEstado,
  }
}

export type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes' | 'personalizado'

/** Suma dias a una fecha AAAA-MM-DD sin pasar por la zona horaria del equipo. */
function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

/** Las fechas de un periodo rapido, contando desde `hoy` (el dia de Colombia). */
export function rangoDePeriodo(periodo: Exclude<Periodo, 'personalizado'>, hoy: string): { desde: string; hasta: string } {
  if (periodo === 'hoy') return { desde: hoy, hasta: hoy }
  if (periodo === 'ayer') {
    const ayer = sumarDias(hoy, -1)
    return { desde: ayer, hasta: ayer }
  }
  if (periodo === 'semana') return { desde: sumarDias(hoy, -6), hasta: hoy }
  return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy }
}

/** "22 sep 2026" o "1 – 22 sep 2026": el periodo en palabras, para el titulo de los resultados. */
export function periodoEnPalabras(desde: string, hasta: string): string {
  const formato = (fecha: string, opciones: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('es-CO', { ...opciones, timeZone: 'UTC' }).format(new Date(`${fecha}T12:00:00Z`))
  if (desde === hasta) return formato(desde, { day: 'numeric', month: 'short', year: 'numeric' })
  const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7)
  const inicio = mismoMes ? formato(desde, { day: 'numeric' }) : formato(desde, { day: 'numeric', month: 'short' })
  return `${inicio} – ${formato(hasta, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

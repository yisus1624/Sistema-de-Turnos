/**
 * Cuanto historico se puede pedir de una vez.
 *
 * POR QUE EXISTE. Sin fechas, el historico devolvia la tabla ENTERA de turnos
 * en una sola consulta: meses de datos cargados en la memoria del servidor y
 * una conexion del pool ocupada mientras tanto, por una pantalla abierta sin
 * filtro o por una peticion hecha a mano. Ahora sin fechas es el dia de hoy, un
 * rango no puede pasar de un trimestre y el resultado tiene un techo de filas.
 */
import { errorDeNegocio } from './errores'
import { esFechaValida } from './tiempo'

/** Un trimestre: cubre los informes mensuales y trimestrales del hospital. */
export const DIAS_MAXIMOS_HISTORICO = 92

/**
 * Techo de filas por consulta. Un dia son ~300 turnos, asi que alcanza para un
 * mes largo sin filtros; si se pasa, la respuesta avisa que hay mas (`truncado`).
 */
export const MAXIMO_FILAS_HISTORICO = 10_000

export interface RangoHistorico {
  fecha?: string
  fechaDesde?: string
  fechaHasta?: string
}

const UN_DIA_MS = 24 * 60 * 60 * 1000

function exigirFecha(fecha: string | undefined) {
  if (fecha !== undefined && !esFechaValida(fecha)) errorDeNegocio('La fecha no es valida. Usa el formato AAAA-MM-DD.')
}

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * UN_DIA_MS).toISOString().slice(0, 10)
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / UN_DIA_MS) + 1
}

function exigirRangoRazonable(desde: string, hasta: string) {
  if (desde > hasta) errorDeNegocio('La fecha inicial no puede ser posterior a la final.')
  if (diasEntre(desde, hasta) > DIAS_MAXIMOS_HISTORICO) {
    errorDeNegocio(`El rango maximo es de ${DIAS_MAXIMOS_HISTORICO} dias. Consulta por partes.`)
  }
}

/**
 * El rango que de verdad se consulta. Sin fechas, hoy; con una sola punta del
 * rango, se completa hasta el maximo (nunca hasta el infinito).
 */
export function acotarRangoDelHistorico(pedido: RangoHistorico, hoy: string): RangoHistorico {
  ;[pedido.fecha, pedido.fechaDesde, pedido.fechaHasta].forEach(exigirFecha)
  // Las dos cosas a la vez eran ambiguas: se usaba la fecha y el rango se
  // ignoraba en silencio, y el informe no decia lo que se habia pedido.
  if (pedido.fecha && (pedido.fechaDesde || pedido.fechaHasta)) {
    errorDeNegocio('Consulta por una fecha o un rango de fechas, no por los dos a la vez.')
  }
  if (pedido.fecha) return { fecha: pedido.fecha }
  if (!pedido.fechaDesde && !pedido.fechaHasta) return { fecha: hoy }

  const fechaHasta = pedido.fechaHasta ?? hoy
  const fechaDesde = pedido.fechaDesde ?? sumarDias(fechaHasta, 1 - DIAS_MAXIMOS_HISTORICO)
  exigirRangoRazonable(fechaDesde, fechaHasta)
  return { fechaDesde, fechaHasta }
}

/** Un rango de varios dias es una extraccion masiva y se deja en auditoria. */
export function abarcaMasDeUnDia(rango: RangoHistorico): boolean {
  return Boolean(rango.fechaDesde && rango.fechaHasta && rango.fechaDesde !== rango.fechaHasta)
}

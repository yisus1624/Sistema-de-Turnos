/**
 * Que parte del catalogo trabajo un dia, deducido de las citas de ese dia.
 *
 * PURO Y COMPARTIDO. No sabe de base de datos: recibe citas ya reducidas a
 * (servicio, consultorio, hora) y devuelve el resumen. Las dos
 * implementaciones del repositorio —la de Postgres y la de memoria— lo usan,
 * para que la respuesta a "quien atendio el martes" no dependa de donde estan
 * guardados los datos.
 *
 * POR QUE NO SE MIRA EL CAMPO `activo`. Ese campo dice que algo existe en el
 * hospital. Lo pone la carga diaria del reporte, que da de alta lo que
 * encuentra y nunca vuelve a apagarlo —y hace bien: un reporte filtrado por un
 * doctor no puede desactivar medio hospital—. La consecuencia es que "activo"
 * acaba significando "alguna vez aparecio en un archivo", y no sirve para saber
 * quien trabaja hoy. Las citas del dia si lo saben.
 */
import type { ActividadCatalogo, ActividadDelDia } from './types'

/** Una cita reducida a lo que hace falta para el resumen. */
export interface CitaParaActividad {
  servicioId: string
  /** Puede faltar: hay doctores sin consultorio asignado. */
  moduloId: string | null
  /** "HH:MM" en hora de Colombia. */
  hora: string
}

function acumular(mapa: Record<string, ActividadDelDia>, clave: string, hora: string) {
  const actual = mapa[clave]
  if (!actual) {
    mapa[clave] = { citas: 1, desde: hora, hasta: hora }
    return
  }

  actual.citas += 1
  if (hora < actual.desde) actual.desde = hora
  if (hora > actual.hasta) actual.hasta = hora
}

/**
 * Agrupa las citas del dia por servicio y por consultorio.
 *
 * Lo que no aparece en el resultado es la respuesta: ese servicio o ese
 * consultorio no atendio ese dia. No se rellenan con ceros a proposito —quien
 * pregunta ya tiene el catalogo entero— y asi la ausencia se distingue de un
 * cero que alguien haya podido calcular mal.
 */
export function reunirActividad(fecha: string, citas: CitaParaActividad[]): ActividadCatalogo {
  const porServicio: Record<string, ActividadDelDia> = {}
  const porModulo: Record<string, ActividadDelDia> = {}

  for (const cita of citas) {
    acumular(porServicio, cita.servicioId, cita.hora)
    if (cita.moduloId) acumular(porModulo, cita.moduloId, cita.hora)
  }

  return { fecha, porServicio, porModulo }
}

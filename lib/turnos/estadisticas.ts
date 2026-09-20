/**
 * Como se cuentan los indicadores de atencion (requerimiento seccion 19).
 *
 * Puro y compartido por las dos implementaciones del repositorio: si cada una
 * contara a su manera, el mismo dia daria numeros distintos segun de donde
 * salieran los datos, y un informe que no cuadra consigo mismo no sirve para
 * decidir nada.
 */
import type { Cita, EstadisticasServicio, Turno } from './types'

export function promedioMinutos(valores: number[]): number | null {
  if (valores.length === 0) return null
  const total = valores.reduce((suma, valor) => suma + valor, 0)
  return Math.round((total / valores.length / 60000) * 10) / 10
}

export function resumir(
  servicioId: string,
  servicioNombre: string,
  turnos: Turno[],
  citas: Cita[],
): EstadisticasServicio {
  const esperas: number[] = []
  const atenciones: number[] = []

  for (const turno of turnos) {
    // La espera se mide contra el PRIMER llamado, nunca contra `horaLlamado`:
    // esa se sobrescribe al repetir el llamado, asi que medir contra ella
    // alargaba en el informe la espera de los pacientes a los que mas costo
    // ubicar. `horaPrimerLlamado` no existe en turnos anteriores a ese cambio,
    // y para esos se sigue usando el ultimo llamado.
    const primerLlamado = turno.horaPrimerLlamado ?? turno.horaLlamado
    if (primerLlamado) {
      esperas.push(new Date(primerLlamado).getTime() - new Date(turno.fechaGeneracion).getTime())
    }
    if (primerLlamado && turno.horaAtencion) {
      atenciones.push(new Date(turno.horaAtencion).getTime() - new Date(primerLlamado).getTime())
    }
  }

  return {
    servicioId,
    servicioNombre,
    generados: turnos.length,
    atendidos: turnos.filter((t) => t.estado === 'ATENDIDO').length,
    ausentes: turnos.filter((t) => t.estado === 'AUSENTE').length,
    pendientes: turnos.filter((t) => t.estado === 'EN_ESPERA').length,
    cerradosAutomaticamente: turnos.filter((t) => t.cierreAutomatico).length,
    // Citado y no vino: la cita se quedo en PROGRAMADA, sin llegada registrada.
    // Es un indicador distinto de `ausentes` (esos si llegaron); no se medía en
    // ningun lado porque, al no haber turno, no existian en el historico.
    //
    // Solo cuentan las citas cuya HORA YA PASO. Si no, a media mañana la
    // inasistencia del dia incluiria a todos los pacientes de la tarde, que
    // simplemente todavia no han llegado.
    inasistencias: citas.filter(
      (c) => c.estado === 'PROGRAMADA' && new Date(c.horaCita).getTime() < Date.now(),
    ).length,
    citasAgendadas: citas.filter((c) => c.estado !== 'CANCELADA').length,
    minutosEsperaPromedio: promedioMinutos(esperas),
    minutosAtencionPromedio: promedioMinutos(atenciones),
  }
}

/**
 * Lo unico que hace falta saber de un turno para ponerlo en la fila.
 *
 * La firma pide ESTOS DOS CAMPOS y no un `Turno` entero para que la regla la
 * pueda aplicar tambien quien no tiene el turno completo en la mano: el
 * televisor, por ejemplo, calcula quien entra despues en cada consultorio
 * leyendo de la base solo el codigo, la prioridad y la hora de generacion. Si
 * exigiera el objeto completo, ese caso acabaria con una copia de la regla al
 * lado, y el dia que cambie el criterio de atencion cambiaria en un sitio y no
 * en el otro: la pantalla anunciaria a un paciente y el doctor llamaria a otro.
 */
export type PuestoEnLaFila = Pick<Turno, 'prioridad' | 'fechaGeneracion'>

/**
 * Orden en el que hay que atender una fila: primero los prioritarios, y dentro
 * de cada grupo por orden de llegada.
 */
export function ordenAtencion(a: PuestoEnLaFila, b: PuestoEnLaFila) {
  if (a.prioridad !== b.prioridad) return a.prioridad === 'PRIORITARIO' ? -1 : 1
  return new Date(a.fechaGeneracion).getTime() - new Date(b.fechaGeneracion).getTime()
}

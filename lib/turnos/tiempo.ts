/**
 * El calendario del hospital: dias, horas y franjas de consulta.
 *
 * Vive aparte porque lo necesitan LAS DOS implementaciones del repositorio (la
 * de memoria y la de base de datos) y ninguna de las dos es dueña de estas
 * reglas: "a que dia pertenece esta cita" y "a que horas se puede agendar" son
 * del dominio, no del almacenamiento. Teniendolo duplicado, cambiar la regla en
 * un sitio y no en el otro haria que la agenda y el historico no cuadraran
 * entre si, que es de los fallos mas dificiles de ver.
 *
 * Todo lo de aqui es PURO: no toca estado ni base de datos.
 */
import type { ConfiguracionSistema, Jornada, Profesional } from './types'

export function ahoraISO() {
  return new Date().toISOString()
}

/**
 * Dia (AAAA-MM-DD) de un instante ISO, EN HORA DE COLOMBIA.
 *
 * Las fechas se guardan en UTC, pero el hospital razona en hora local
 * (America/Bogota, UTC-5). Recortar el ISO daria el dia UTC: despues de las
 * 7 p. m. en Colombia el dia UTC ya es el siguiente, y el historico de "hoy"
 * saldria en cero.
 */
export function diaColombia(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(iso))
}

/** "HH:MM" de un instante, en hora de Colombia. */
export function horaColombia(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

/** "07:30" -> 450. Devuelve NaN si la hora no tiene forma de hora. */
export function aMinutos(hora: string): number {
  const partes = /^(\d{1,2}):(\d{2})$/.exec(hora.trim())
  if (!partes) return Number.NaN

  const horas = Number(partes[1])
  const minutos = Number(partes[2])
  if (horas > 23 || minutos > 59) return Number.NaN

  return horas * 60 + minutos
}

/** 450 -> "07:30". */
export function aHora(minutos: number): string {
  const dosDigitos = (n: number) => String(n).padStart(2, '0')
  return `${dosDigitos(Math.floor(minutos / 60))}:${dosDigitos(minutos % 60)}`
}

/**
 * Franjas ya calculadas, por jornada y duracion.
 *
 * No crece: las claves posibles son las combinaciones de horario que el
 * administrador llegue a configurar, un puñado en toda la vida del sistema. La
 * lista se devuelve tal cual, asi que NADIE debe modificarla.
 */
const franjasMemorizadas = new Map<string, string[]>()

/**
 * Franjas en las que se puede agendar dentro de una jornada.
 *
 * La ultima franja tiene que CABER COMPLETA antes del cierre: con consultas de
 * 15 minutos y una jornada que termina a las 12:00, la ultima cita es a las
 * 11:45 y no a las 11:55. Una configuracion incoherente (cierre antes de la
 * apertura, o una consulta mas larga que la jornada) devuelve una lista vacia
 * en vez de reventar: la pantalla lo muestra como "sin franjas" y el
 * administrador lo corrige.
 */
export function franjasDeJornada(inicio: string, fin: string, duracionMinutos: number): string[] {
  // Esto se llama en bucle (una vez por cita al armar la parrilla, dos por
  // cada comprobacion de franja) para devolver siempre lo mismo.
  const clave = `${inicio}|${fin}|${duracionMinutos}`
  const memorizadas = franjasMemorizadas.get(clave)
  if (memorizadas) return memorizadas

  const desde = aMinutos(inicio)
  const hasta = aMinutos(fin)
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || duracionMinutos < 1) return []

  const franjas: string[] = []
  for (let minuto = desde; minuto + duracionMinutos <= hasta; minuto += duracionMinutos) {
    franjas.push(aHora(minuto))
  }

  franjasMemorizadas.set(clave, franjas)
  return franjas
}

/**
 * Instante ISO de una hora de un dia concreto EN COLOMBIA.
 *
 * El desfase se escribe a mano (-05:00) en vez de usar la zona del proceso:
 * Colombia no tiene horario de verano, y si el servidor esta en otra zona
 * (pasa: equipos de desarrollo en Europa) la cita caeria en el dia equivocado.
 */
export function instanteDeFranja(dia: string, hora: string): string {
  return new Date(`${dia}T${hora}:00-05:00`).toISOString()
}

export const ETIQUETA_JORNADA: Record<Jornada, string> = {
  MANANA: 'la jornada de la mañana',
  TARDE: 'la jornada de la tarde',
  COMPLETA: 'el dia completo',
}

/** Si el doctor trabaja en esa jornada. `COMPLETA` atiende en las dos. */
export function atiendeEnJornada(
  profesional: Pick<Profesional, 'jornada'>,
  bloque: 'MANANA' | 'TARDE',
) {
  return profesional.jornada === 'COMPLETA' || profesional.jornada === bloque
}

/** Las dos jornadas del hospital, para ubicar una hora entre ellas. */
type HorarioDelHospital = Pick<ConfiguracionSistema, 'jornadaMananaFin' | 'jornadaTardeInicio'>

/**
 * A que jornada pertenece una hora del dia, o `null` si esta en el almuerzo.
 *
 * A DIFERENCIA DE "¿cae en una franja?", esto no pregunta si a esa hora se
 * puede agendar: pregunta de quien es esa hora. Por eso responde tambien para
 * las 7:09 o las 16:14, que no son cupos validos pero si horas a las que el
 * hospital cita gente (su reporte viene lleno de ellas).
 *
 * EL HUECO DEL ALMUERZO NO ES DE NADIE, y por eso devuelve `null`. Repartirlo
 * al lado que sea da resultados falsos: en el hospital hay cuatro doctores que
 * atienden de 12:20 a 16:14, o sea la jornada de la tarde entrando un poco
 * antes. Contando esas 12:20 como mañana, los cuatro salian de "dia completo",
 * que es exactamente lo que se quiere dejar de ver. Ignorando el hueco, lo que
 * decide es donde esta de verdad su trabajo: despues de la una.
 */
export function jornadaDeHora(hora: string, horario: HorarioDelHospital): 'MANANA' | 'TARDE' | null {
  const minutos = aMinutos(hora)
  const cierraLaManana = aMinutos(horario.jornadaMananaFin)
  const abreLaTarde = aMinutos(horario.jornadaTardeInicio)
  if (!Number.isFinite(minutos)) return null

  if (Number.isFinite(cierraLaManana) && minutos < cierraLaManana) return 'MANANA'
  if (Number.isFinite(abreLaTarde) && minutos >= abreLaTarde) return 'TARDE'
  return null
}

/**
 * La jornada que se deduce de las horas a las que un doctor tiene pacientes.
 *
 * POR QUE SE DEDUCE Y NO SE PREGUNTA. La agenda del hospital llega en un
 * reporte que no trae una columna "jornada", asi que hasta ahora todos los
 * doctores entraban como dia COMPLETO. El efecto en la parrilla es que un
 * medico que solo atiende hasta las once aparece tambien en la tarde y que el
 * que agenda le puede citar un paciente a las tres. Sus horas si lo dicen:
 * quien solo tiene pacientes antes del mediodia es de la mañana, quien solo los
 * tiene de la una en adelante es de la tarde, y quien tiene de los dos lados
 * hace el dia completo.
 *
 * Devuelve `null` cuando no hay ninguna hora que ubicar: sin citas no hay nada
 * que deducir, y en ese caso lo correcto es dejar la jornada como este, no
 * inventarle una.
 */
export function jornadaSegunHoras(horas: string[], horario: HorarioDelHospital): Jornada | null {
  let manana = false
  let tarde = false

  for (const hora of horas) {
    const jornada = jornadaDeHora(hora, horario)
    // El almuerzo no cuenta para ningun lado: ver `jornadaDeHora`.
    if (jornada === 'MANANA') manana = true
    else if (jornada === 'TARDE') tarde = true
    if (manana && tarde) return 'COMPLETA'
  }

  if (manana) return 'MANANA'
  if (tarde) return 'TARDE'
  return null
}

/**
 * En que bloque de la parrilla se pinta una cita.
 *
 * Se parece a `jornadaDeHora`, pero aqui NO se puede responder "en ninguno": la
 * cita del almuerzo tiene que verse en algun sitio o el paciente desaparece de
 * la agenda. Se resuelve con la jornada del propio doctor, que es lo que le da
 * sentido a esa hora: las 12:20 del que atiende de 12:20 a 16:14 son su tarde;
 * las 12:20 del que atiende de 7 a 12:30 son su mañana alargada.
 */
export function bloqueDeCita(
  hora: string,
  horario: HorarioDelHospital,
  jornadaDelDoctor: Jornada | null,
): 'MANANA' | 'TARDE' {
  const jornada = jornadaDeHora(hora, horario)
  if (jornada) return jornada

  // Hora de almuerzo: manda el doctor. Si hace el dia completo (o no se sabe),
  // se toma como mañana alargada, que es lo que suele ser.
  return jornadaDelDoctor === 'TARDE' ? 'TARDE' : 'MANANA'
}

/** Formato AAAA-MM-DD, que es como entran las fechas por la API. */
export function esFechaValida(fecha: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha)
}

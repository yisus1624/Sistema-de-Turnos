import type { CasillaPantalla } from './types'
import { claveDeCasilla } from './casillas'

/**
 * Cuanto tiempo despues de un llamado todavia vale la pena anunciarlo al
 * ponerse al dia. Un llamado de hace un par de minutos (la red se cayo justo
 * entonces) tiene que sonar: el paciente sigue en la sala esperando. Uno de
 * hace media hora ya no: sonar por el seria confundir a la sala.
 */
export const MS_LLAMADO_RECIENTE = 5 * 60 * 1000

/**
 * Cuanto puede ir un llamado "por delante" de la hora del servidor sin dejar de
 * ser creible. La hora del llamado y la de la foto las pone el mismo servidor,
 * asi que no deberia haber adelanto; el margen cubre los ajustes pequeños de
 * su reloj (NTP). Mas alla de eso, una hora futura es un reloj descuadrado y
 * no se anuncia.
 */
const MS_TOLERANCIA_FUTURO = 5000

export type ResultadoMezcla = {
  casillas: CasillaPantalla[]
  /**
   * Modulos cuyo llamado (nuevo o repetido) aparecio con esta foto, del mas
   * viejo al mas reciente: el ultimo es el que se resalta.
   */
  llamadosNuevos: string[]
}

type Llamado = Pick<CasillaPantalla, 'codigo' | 'horaLlamado' | 'vecesLlamado'>

/** Si dos casillas muestran el mismo llamado: mismo turno, misma hora, mismo conteo. */
function esElMismoLlamado(a: Llamado, b: Llamado): boolean {
  return a.codigo === b.codigo && a.horaLlamado === b.horaLlamado && (a.vecesLlamado ?? 0) === (b.vecesLlamado ?? 0)
}

/**
 * Aplica la foto completa del servidor sobre lo que la pantalla ya tiene.
 *
 * La foto es del instante en que el servidor respondio. Si durante el viaje
 * llego por el canal en vivo un evento de un consultorio, la casilla de ESE
 * consultorio que trae la foto es mas vieja que la pintada y se conserva la
 * pintada. Las demas se toman de la foto.
 *
 * Tambien dice que llamados trae la foto que la pantalla no habia visto: los
 * ocurridos mientras no habia conexion. Sin eso aparecian en silencio y la
 * sala no levantaba la vista. En la primera carga (`previas` vacia) no se
 * anuncia nada: no es un llamado, es el televisor encendiendose.
 *
 * `ahoraMs` es la hora DEL SERVIDOR (viaja con la foto): comparar con el reloj
 * del PC del televisor, que puede ir minutos adelantado o atrasado, hacia
 * sonar llamados viejos o callar los recientes.
 */
export function mezclarFotoDePantalla(
  previas: CasillaPantalla[],
  foto: CasillaPantalla[],
  tocadosDuranteElViaje: ReadonlySet<string>,
  ahoraMs: number,
): ResultadoMezcla {
  const porModulo = new Map(previas.map((c) => [claveDeCasilla(c), c]))
  const nuevos: CasillaPantalla[] = []

  const casillas = foto.map((nueva) => {
    const previa = porModulo.get(claveDeCasilla(nueva))
    if (previa && tocadosDuranteElViaje.has(claveDeCasilla(nueva))) return previa

    if (previa && esLlamadoNoVisto(previa, nueva, ahoraMs)) nuevos.push(nueva)
    return nueva
  })

  return { casillas, llamadosNuevos: ordenarPorHora(nuevos).map(claveDeCasilla) }
}

function ordenarPorHora(casillas: CasillaPantalla[]): CasillaPantalla[] {
  return [...casillas].sort((a, b) => Date.parse(a.horaLlamado ?? '') - Date.parse(b.horaLlamado ?? ''))
}

function esLlamadoNoVisto(previa: CasillaPantalla, nueva: CasillaPantalla, ahoraMs: number) {
  if (!nueva.codigo || !nueva.horaLlamado) return false
  if (esElMismoLlamado(previa, nueva)) return false

  const antiguedad = ahoraMs - Date.parse(nueva.horaLlamado)
  return antiguedad >= -MS_TOLERANCIA_FUTURO && antiguedad <= MS_LLAMADO_RECIENTE
}

export type DecisionLlamadoEnVivo = 'anunciar' | 'reemplazar_en_silencio'

/**
 * Que hacer con un llamado que llega por el canal en vivo.
 *
 * El llamado se publica DESPUES de guardarse. Si justo en medio la pantalla se
 * resincronizo, la foto ya lo trajo —y sono—; cuando despues llega el evento
 * es el MISMO llamado y no debe volver a sonar: la sala oiria dos campanadas y
 * contaria dos pacientes. Un rellamado cambia el conteo y la hora, asi que ese
 * si suena.
 */
export function decidirLlamadoEnVivo(
  pintada: CasillaPantalla | undefined,
  llegada: CasillaPantalla,
): DecisionLlamadoEnVivo {
  return pintada && esElMismoLlamado(pintada, llegada) ? 'reemplazar_en_silencio' : 'anunciar'
}

import type { CasillaPantalla } from './types'
import { casillaLibreDe, claveDeCasilla } from './casillas'

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
  const pintadasPorModulo = agruparPorModulo(previas)
  const casillas: CasillaPantalla[] = []
  const nuevos: CasillaPantalla[] = []

  for (const [moduloId, deLaFoto] of agruparPorModulo(foto)) {
    const pintadas = pintadasPorModulo.get(moduloId) ?? []
    const mezcla = mezclarConsultorio(pintadas, deLaFoto, tocadosDuranteElViaje)
    casillas.push(...mezcla)
    nuevos.push(...mezcla.filter((c) => esLlamadoNoVisto(pintadas, c, ahoraMs)))
  }

  return { casillas, llamadosNuevos: ordenarPorHora(nuevos).map(claveDeCasilla) }
}

/** Las casillas de cada consultorio, en el orden en que aparecen. */
function agruparPorModulo(casillas: CasillaPantalla[]): Map<string, CasillaPantalla[]> {
  const grupos = new Map<string, CasillaPantalla[]>()
  for (const casilla of casillas) grupos.set(casilla.moduloId, [...(grupos.get(casilla.moduloId) ?? []), casilla])
  return grupos
}

/**
 * Las casillas de UN consultorio tras la foto, puesto por puesto.
 *
 * SE COMPARA POR CONSULTORIO, NO SOLO POR CLAVE: la casilla libre no trae
 * puesto (clave "M") y la ocupada si ("M~P"). Comparando solo la clave, un
 * llamado sobre un consultorio Libre no encontraba su casilla previa y entraba
 * sin campana, y un "Atendido" llegado durante el viaje (lo pintado ya era la
 * libre "M") dejaba que la foto vieja repintara el turno cerrado.
 *
 * Los puestos que recibieron un evento durante el viaje se quedan como estan
 * pintados; los demas, como dice la foto. Si no queda ningun puesto ocupado, el
 * consultorio muestra su casilla libre.
 */
function mezclarConsultorio(
  pintadas: CasillaPantalla[],
  deLaFoto: CasillaPantalla[],
  tocados: ReadonlySet<string>,
): CasillaPantalla[] {
  const tocada = (c: CasillaPantalla) => tocados.has(claveDeCasilla(c))
  const ocupadas = [
    ...deLaFoto.filter((c) => c.codigo && !tocada(c)),
    ...pintadas.filter((c) => c.codigo && tocada(c)),
  ]
  if (ocupadas.length > 0) return ocupadas
  const estaLibre = (c: CasillaPantalla) => !c.codigo
  return [deLaFoto.find(estaLibre) ?? pintadas.find(estaLibre) ?? casillaLibreDe(deLaFoto[0])]
}

function ordenarPorHora(casillas: CasillaPantalla[]): CasillaPantalla[] {
  return [...casillas].sort((a, b) => Date.parse(a.horaLlamado ?? '') - Date.parse(b.horaLlamado ?? ''))
}

/**
 * Un llamado que el televisor no llego a ver en ESE consultorio. Un
 * consultorio que no tenia pintado (la primera carga) no anuncia nada: no es
 * un llamado perdido, es el televisor encendiendose.
 */
function esLlamadoNoVisto(pintadas: CasillaPantalla[], nueva: CasillaPantalla, ahoraMs: number) {
  if (!nueva.codigo || !nueva.horaLlamado || pintadas.length === 0) return false
  if (pintadas.some((previa) => esElMismoLlamado(previa, nueva))) return false

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

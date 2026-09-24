/**
 * Decisiones del televisor de la sala de espera que no dependen de React.
 *
 * Viven aqui para poder probarlas: que aviso de sonido mostrar, que decir
 * cuando todavia no hay casillas y que filas lleva la cartelera. Son reglas de
 * lo que la sala tiene que ver, no de como se dibuja.
 */
import type { EstadoDelAudio } from './anuncio'
import type { CasillaPantalla } from './types'

/**
 * Cuanto dura el resalte (fila azul que destella) de un turno recien llamado.
 * Cada llamado tiene el suyo: varios pueden estar resaltados a la vez. Lo usa
 * tambien la rotacion de paginas, que no se va de la pagina antes.
 */
export const MS_RESALTE = 20000

/**
 * Cuanto dura la etiqueta "NUEVO" de un turno recien llamado: mas que el
 * resalte, para quien levanta la vista tarde y quiere saber que cambio.
 */
export const MS_NUEVO = 60000

/** Los llamados recientes que el televisor marca (ver `useResaltes`). */
export interface Resaltes {
  /** El ultimo llamado: la rotacion de paginas salta a su pagina. */
  ultimo: string | null
  /**
   * Sube con cada llamado, aunque sea del mismo puesto: un segundo llamado del
   * consultorio de siempre tambien tiene que saltar a su pagina.
   */
  contador?: number
  /** Filas que se pintan de azul y destellan. */
  resaltados: ReadonlySet<string>
  /** Filas que llevan la etiqueta "NUEVO". */
  nuevos: ReadonlySet<string>
}

export const SIN_RESALTES: Resaltes = { ultimo: null, contador: 0, resaltados: new Set(), nuevos: new Set() }

export type AvisoDeSonido = 'tocar_para_activar' | null

/**
 * Si hay que avisar de que el sonido esta bloqueado.
 *
 * Solo cuando alguien deberia oir la campana y el navegador no la deja: si el
 * hospital apago el audio o esta sala se dejo en mudo a proposito, no hay
 * nada que avisar. El aviso es pequeño y no tapa los turnos.
 */
export function avisoDeSonido(estado: {
  audio: EstadoDelAudio
  mudoDelTelevisor: boolean
  audioDelHospital: boolean
}): AvisoDeSonido {
  const deberiaSonar = estado.audioDelHospital && !estado.mudoDelTelevisor
  return deberiaSonar && estado.audio === 'bloqueado' ? 'tocar_para_activar' : null
}

/** En que punto esta la carga de la pantalla. */
export type EstadoDeCarga = 'cargando' | 'listo' | 'sin_conexion'

/**
 * Lo que se lee cuando no hay ninguna casilla.
 *
 * Antes, si la primera carga fallaba, la sala leia "Aun no hay consultorios ni
 * ventanillas activos" cuando lo que faltaba era conexion. Mientras no hayan
 * llegado datos, el mensaje es neutro: no alarma a la sala ni le afirma algo
 * falso. La pantalla sigue intentandolo sola.
 */
export function mensajeSinCasillas(estado: EstadoDeCarga): string {
  if (estado === 'listo') return 'Aun no hay consultorios ni ventanillas activos.'
  return 'Conectando con el sistema de turnos...'
}

/**
 * Las filas de la cartelera: TODOS los consultorios con turno en curso, CADA
 * UNO EN SU SITIO FIJO.
 *
 * Antes iban del llamado mas reciente al mas antiguo, asi que con cada llamado
 * las filas cambiaban de lugar: el paciente que ya habia ubicado a su doctor
 * lo perdia de vista, y la sala veia la tabla entera moverse. Ahora el orden
 * es por consultorio y doctor, que no cambia en toda la jornada: al llamar
 * solo cambia el numero de turno de ESA fila (y se resalta).
 *
 * `masReciente` es el ultimo llamado, para lo que la cabecera dice del servicio.
 */
export function filasDeCartelera(casillas: CasillaPantalla[]): {
  filas: CasillaPantalla[]
  masReciente: CasillaPantalla | null
} {
  const llamados = casillas.filter((casilla) => Boolean(casilla.codigo))
  const masReciente = llamados.reduce<CasillaPantalla | null>(
    (ultimo, c) => (!ultimo || (c.horaLlamado ?? '') > (ultimo.horaLlamado ?? '') ? c : ultimo),
    null,
  )
  const orden = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })
  const filas = [...llamados].sort(
    (a, b) =>
      orden.compare(a.moduloNombre, b.moduloNombre) ||
      orden.compare(a.profesionalNombre ?? '', b.profesionalNombre ?? '') ||
      orden.compare(a.puesto ?? a.moduloId, b.puesto ?? b.moduloId),
  )
  return { filas, masReciente }
}

/** Los eventos que no traen casilla y obligan al televisor a pedir la foto entera. */
const EVENTOS_QUE_RESINCRONIZAN: ReadonlySet<string> = new Set(['configuracion.cambiada', 'datos.reiniciados'])

/**
 * Si el evento obliga a resincronizar: el administrador cambio la
 * configuracion, o la simulacion reinicio el dia. Resincronizar nunca suena por
 * si mismo: solo suenan los llamados recientes que la foto traiga y la
 * pantalla no hubiera visto (ver `mezclarFotoDePantalla`).
 */
export function eventoPideResincronizar(evento: { tipo: string }): boolean {
  return EVENTOS_QUE_RESINCRONIZAN.has(evento.tipo)
}

/**
 * El canal de eventos en vivo, visto desde los DOS lados.
 *
 * Aqui vive lo unico que el servidor (app/api/turnos/stream) y las pantallas
 * tienen que entender igual: como se serializa un mensaje, cada cuanto late el
 * canal y cuanto silencio se tolera antes de desconfiar de lo que se ve.
 *
 * Se separa del hub a proposito: el hub usa `EventEmitter` de Node y solo corre
 * en el servidor; esto lo importa tambien el navegador, asi que del hub solo se
 * toma el TIPO (los tipos se borran al compilar).
 */
import type { EventoTurno } from './hub'

/** De donde cuelga el canal. Lo usan todas las pantallas que escuchan. */
export const RUTA_EVENTOS_EN_VIVO = '/api/turnos/stream'

/**
 * Latido del canal.
 *
 * Va como evento CON DATOS, no como comentario SSE, porque los comentarios no
 * llegan a `onmessage`: el cliente no podria notar que dejaron de llegar. Ese
 * aviso es justamente lo que delata una conexion muerta en silencio.
 */
export const LATIDO = { tipo: 'latido' } as const

export type MensajeEnVivo = EventoTurno | typeof LATIDO

/** Cada cuanto late el servidor por el canal. */
export const MS_LATIDO = 20000

/** Cuantos latidos seguidos puede perder el cliente antes de desconfiar. */
const LATIDOS_TOLERADOS = 3

/** Margen para la red: un latido puede llegar mas tarde de lo previsto. */
const MS_MARGEN_DE_RED = 5000

/**
 * Silencio total (ni datos ni latidos) tras el cual se da la conexion por
 * muerta. Mas corto reconectaria a todo el hospital por un hipo de la red; mas
 * largo deja al consultorio mirando una fila vieja demasiado tiempo.
 */
export const MS_SILENCIO_MAXIMO = MS_LATIDO * LATIDOS_TOLERADOS + MS_MARGEN_DE_RED

export function formatearMensajeSse(mensaje: MensajeEnVivo): string {
  return `data: ${JSON.stringify(mensaje)}\n\n`
}

/** Lee un mensaje del canal. Devuelve `null` si no es uno de los nuestros. */
export function interpretarMensaje(datos: string): MensajeEnVivo | null {
  try {
    return JSON.parse(datos) as MensajeEnVivo
  } catch {
    return null
  }
}

/** El latido mantiene viva la conexion, pero no trae ninguna novedad. */
export function esCambioDeDatos(mensaje: MensajeEnVivo): mensaje is EventoTurno {
  return mensaje.tipo !== LATIDO.tipo
}

type Fila = {
  servicioId?: string
  profesionalId?: string
  /**
   * En que consultorio se esta atendiendo esa fila, si es de uno solo. Las
   * ventanillas NO lo declaran: comparten fila, asi que lo que llame una le
   * quita gente a las demas.
   */
  moduloId?: string | null
}

/**
 * Si el evento obliga a recargar a quien atiende esa fila.
 *
 * Los eventos que no son de fila pasan casi siempre: cambian el estado general
 * y le interesan a cualquiera que mire.
 *
 * La excepcion es el LLAMADO DE OTRO CONSULTORIO cuando quien pregunta atiende
 * una fila propia. Antes pasaban todos, asi que cada paciente que entraba en
 * cualquier consultorio hacia que las pantallas de los otros siete pidieran su
 * fila entera para pintar exactamente lo mismo. Y no le cambia nada: la fila de
 * un doctor son SUS pacientes. El llamado del propio consultorio si pasa,
 * porque ahi acaba de salir uno de la fila.
 */
export function afectaALaFila(evento: EventoTurno, fila: Fila): boolean {
  if (evento.tipo === 'turno.llamado') {
    if (!fila.moduloId || !evento.casilla.moduloId) return true
    return evento.casilla.moduloId === fila.moduloId
  }

  if (evento.tipo !== 'fila.cambiada') return true

  const esDelServicio = !fila.servicioId || evento.servicioId === fila.servicioId
  const esDelProfesional = !fila.profesionalId || evento.profesionalId === fila.profesionalId
  return esDelServicio && esDelProfesional
}

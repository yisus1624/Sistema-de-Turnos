/**
 * Recuperacion sola de una pantalla que se rompio al dibujarse.
 *
 * POR QUE EXISTE. Sin limite de errores, una excepcion al pintar dejaba la
 * pantalla en blanco ("Application error") para siempre. En una pestaña del
 * administrador eso se arregla recargando; en el TELEVISOR de la sala de
 * espera no hay nadie delante que recargue, y la sala se queda sin turnos
 * hasta que alguien se da cuenta. Los `error.tsx` de `app/` muestran un aviso,
 * y los de las pantallas que no pueden quedarse quietas (televisor y
 * consultorio) usan esto para volver solos.
 *
 * DOS ESCALONES. Primero se vuelve a pintar la pantalla, sin recargarla y con
 * espera creciente: casi siempre basta, porque lo que la rompio fue un dato de
 * ese momento y al volver a montarse lo pide de nuevo. Si pasado un rato sigue
 * rota y a esa pantalla se le permite, se recarga entera.
 *
 * LA RACHA VIVE FUERA DEL AVISO. React desmonta el aviso de error y monta uno
 * nuevo con cada reintento que vuelve a fallar: lo que guardara en su estado
 * volveria a cero, la espera no creceria nunca y la recarga se aplazaria para
 * siempre. Por eso cada pantalla guarda su `RachaDeFallos` a nivel de modulo.
 *
 * SOLO SE RECARGA SI EL SERVIDOR CONTESTA. Recargar con el servidor caido (un
 * reinicio, un despliegue) deja en el televisor la pagina de error del
 * navegador, que no tiene codigo para volver sola. Se pregunta antes, y si no
 * contesta se vuelve a preguntar un poco despues.
 *
 * Sin React ni navegador: se prueba en Node con un reloj de mentira.
 */
import { programadorReal, type Programador } from '@/lib/programador'
import { esperaDeReintento } from './reintento'

/**
 * Pasado este rato sin fallar, el siguiente fallo empieza una racha nueva.
 *
 * Mientras la pantalla sigue rota los fallos llegan, como mucho, cada tope de
 * espera de reintento (unos 30 s): una racha no se corta sola a mitad.
 */
const MS_OLVIDO_DE_RACHA = 2 * 60_000

/** Si el servidor no contesto, cuanto se espera para volver a preguntarle. */
const MS_ENTRE_PREGUNTAS = 10_000

/** Cuanto se espera la respuesta del servidor antes de darlo por callado. */
const MS_LIMITE_PREGUNTA = 5_000

export interface FalloAnotado {
  /** Cuantos reintentos van en esta racha (0 en el primer fallo). */
  intento: number
  msDesdeElPrimero: number
}

export interface RachaDeFallos {
  anotar: (ahoraMs: number) => FalloAnotado
}

export function crearRachaDeFallos(): RachaDeFallos {
  let desde = 0
  let ultimo = Number.NEGATIVE_INFINITY
  let intento = 0
  return {
    anotar(ahoraMs) {
      const esRachaNueva = ahoraMs - ultimo > MS_OLVIDO_DE_RACHA
      intento = esRachaNueva ? 0 : intento + 1
      if (esRachaNueva) desde = ahoraMs
      ultimo = ahoraMs
      return { intento, msDesdeElPrimero: ahoraMs - desde }
    },
  }
}

/** La recarga entera, para la pantalla que no tiene a nadie delante. */
export interface Recarga {
  /** Cuanto tiempo rota, desde el primer fallo de la racha, antes de recargar. */
  trasMs: number
  servidorResponde: () => Promise<boolean>
  recargar: () => void
}

export interface OpcionesDeRecuperacion {
  racha: RachaDeFallos
  /** Vuelve a pintar la pantalla sin recargarla (el `reset` del limite de errores). */
  reintentar: () => void
  /** Solo la pantalla que puede recargarse sola. Sin ella, nunca se recarga. */
  recarga?: Recarga
  programar?: Programador
  ahora?: () => number
  espera?: (intento: number) => number
}

/**
 * Programa la vuelta de ESTE fallo: se llama al montar el aviso de error.
 * Devuelve como cancelarla, para cuando el aviso se desmonte.
 */
export function programarRecuperacion(opciones: OpcionesDeRecuperacion): () => void {
  const { racha, reintentar, recarga, programar = programadorReal, ahora = Date.now, espera = esperaDeReintento } = opciones
  const fallo = racha.anotar(ahora())
  const agenda = crearAgenda(programar)

  agenda.poner(reintentar, espera(fallo.intento))
  if (recarga) {
    const intentarRecargar = () => void recargarSiResponde(recarga, agenda, intentarRecargar)
    agenda.poner(intentarRecargar, Math.max(0, recarga.trasMs - fallo.msDesdeElPrimero))
  }
  return agenda.cancelar
}

interface Agenda {
  poner: (accion: () => void, ms: number) => void
  estaVigente: () => boolean
  /** Definitivo: despues ya no se programa nada. */
  cancelar: () => void
}

/** Lo que tiene programado un aviso, para cancelarlo todo junto al desmontarse o al recargar. */
function crearAgenda(programar: Programador): Agenda {
  const pendientes = new Set<() => void>()
  let vigente = true
  return {
    poner(accion, ms) {
      if (!vigente) return
      const cancelar = programar(() => {
        pendientes.delete(cancelar)
        accion()
      }, ms)
      pendientes.add(cancelar)
    },
    estaVigente: () => vigente,
    cancelar() {
      vigente = false
      pendientes.forEach((cancelar) => cancelar())
      pendientes.clear()
    },
  }
}

/**
 * Recarga solo si el servidor contesta; si no, vuelve a preguntar despues.
 * Recargar es definitivo: lo que quedara programado se cancela antes.
 */
async function recargarSiResponde(recarga: Recarga, agenda: Agenda, volverAPreguntar: () => void): Promise<void> {
  const responde = await recarga.servidorResponde().catch(() => false)
  if (!agenda.estaVigente()) return
  if (!responde) return agenda.poner(volverAPreguntar, MS_ENTRE_PREGUNTAS)
  agenda.cancelar()
  recarga.recargar()
}

/**
 * Si la pagina responde de verdad: un 200, no un 502 de nginx mientras el
 * servidor arranca ni un 429 de exceso de peticiones. Una pregunta que se
 * queda colgada se abandona pasado `msLimite`.
 *
 * Es un HEAD a la propia pagina: no trae el cuerpo y demuestra justo lo que
 * hace falta, que al recargar la pagina va a llegar.
 */
export async function paginaResponde(url: string, msLimite = MS_LIMITE_PREGUNTA): Promise<boolean> {
  const control = new AbortController()
  const limite = setTimeout(() => control.abort(), msLimite)
  try {
    const respuesta = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: control.signal })
    return respuesta.ok
  } catch {
    return false
  } finally {
    clearTimeout(limite)
  }
}

/** La recarga de verdad, en el navegador: pregunta por la pagina actual y la recarga. */
export function recargaDelNavegador(trasMs: number): Recarga {
  return {
    trasMs,
    servidorResponde: () => paginaResponde(window.location.href),
    recargar: () => window.location.reload(),
  }
}

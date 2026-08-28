/**
 * Llamado por audio de la pantalla de la sala de espera (requerimiento
 * seccion 11).
 *
 * Dos problemas que resuelve este modulo:
 *
 * 1. LA VOZ. `speechSynthesis` usa las voces instaladas en el equipo. Si no hay
 *    ninguna en español, el navegador NO avisa: lee el texto español con la voz
 *    inglesa por defecto y suena a extranjero. Por eso `elegirVoz` prioriza
 *    ANTES QUE NADA el pais (Colombia primero) y devuelve `null` si no hay
 *    ninguna voz en español, para callar en vez de sonar mal.
 *
 * 2. LOS LLAMADOS SIMULTANEOS. Si cuatro consultorios pulsan "siguiente" casi
 *    al tiempo, hablar de inmediato haria que cada anuncio cortara al anterior
 *    y solo se oiria el ultimo. `ColaDeAnuncios` los encola y los dice uno tras
 *    otro, completos.
 */
import type { CasillaPantalla } from './types'

const DIGITOS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']

/**
 * Deletrea el codigo para que se entienda en una sala ruidosa:
 * "A-014" -> "A, cero uno cuatro".
 */
export function deletrearCodigo(codigo: string): string {
  const partes = codigo.split('').map((caracter) => {
    if (caracter >= '0' && caracter <= '9') return DIGITOS[Number(caracter)]
    if (caracter === '-' || caracter === ' ') return ','
    return caracter.toLocaleUpperCase('es')
  })

  return partes.join(' ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
}

/**
 * Texto que se lee en voz alta: SOLO el codigo del turno y a donde dirigirse.
 *
 * El nombre del paciente aparece en la pantalla pero NO se dice por el
 * altavoz. Un nombre leido en voz alta se oye en toda la sala y en el pasillo,
 * mientras que el de la pantalla solo lo ve quien mira; ademas el anuncio
 * queda mas corto, que es lo que importa cuando hay varios en cola.
 */
export function textoAnuncio(casilla: CasillaPantalla): string {
  return `Turno ${deletrearCodigo(casilla.codigo ?? '')}. Por favor dirigirse a ${casilla.moduloNombre}.`
}

/**
 * Puntaje de una voz. El PAIS pesa mucho mas que la naturalidad: preferimos una
 * voz colombiana aunque sea sintetica antes que una voz neuronal de España,
 * porque el acento y el "usted/ustedes" cambian como suena el llamado.
 */
function puntuarVoz(voz: SpeechSynthesisVoice): number {
  const idioma = voz.lang.toLowerCase().replace('_', '-')
  if (!idioma.startsWith('es')) return -1

  let puntos: number
  if (idioma.startsWith('es-co')) puntos = 1000
  else if (/^es-(419|mx|ve|ec|pe|pa|cr|do|gt|hn|ni|sv|bo|py|uy|cl|ar)/.test(idioma)) puntos = 600
  else if (idioma.startsWith('es-us')) puntos = 400
  else if (idioma.startsWith('es-es')) puntos = 200
  else puntos = 300

  // A igualdad de pais, la voz neuronal suena mucho mejor que la local.
  const nombre = voz.name.toLowerCase()
  if (nombre.includes('natural') || nombre.includes('neural')) puntos += 60
  if (nombre.includes('online')) puntos += 30
  if (nombre.includes('google')) puntos += 20

  return puntos
}

/**
 * Mejor voz en español disponible.
 *
 * Devuelve `null` si el equipo no tiene ninguna: en ese caso NO se debe hablar,
 * porque el navegador usaria una voz de otro idioma.
 */
export function elegirVoz(voces: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const candidatas = voces
    .map((voz) => ({ voz, puntos: puntuarVoz(voz) }))
    .filter((c) => c.puntos >= 0)
    .sort((a, b) => b.puntos - a.puntos)

  return candidatas[0]?.voz ?? null
}

/** Todas las voces en español del equipo, de mejor a peor, para el selector. */
export function vocesEnEspanol(voces: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voces
    .map((voz) => ({ voz, puntos: puntuarVoz(voz) }))
    .filter((c) => c.puntos >= 0)
    .sort((a, b) => b.puntos - a.puntos)
    .map((c) => c.voz)
}

/** `true` si la voz es de Colombia; la pantalla lo usa para avisar al operador. */
export function esVozColombiana(voz: SpeechSynthesisVoice | null): boolean {
  return Boolean(voz?.lang.toLowerCase().replace('_', '-').startsWith('es-co'))
}


/**
 * Las voces se cargan de forma asincrona: en el primer render la lista suele
 * venir vacia y el navegador dispara `voiceschanged` cuando ya estan listas.
 */
export function alCargarVoces(callback: (voces: SpeechSynthesisVoice[]) => void): () => void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return () => {}

  const sintesis = window.speechSynthesis
  const emitir = () => callback(sintesis.getVoices())

  emitir()
  sintesis.addEventListener('voiceschanged', emitir)
  return () => sintesis.removeEventListener('voiceschanged', emitir)
}

export interface OpcionesAnuncio {
  voz: SpeechSynthesisVoice | null
  repeticiones: number
  volumen: number
}

/** Lo que la cola necesita para hablar. Se inyecta para poder probarla. */
export type Locutor = (texto: string, opciones: OpcionesAnuncio) => Promise<void>

/**
 * Cola de anuncios: garantiza que dos llamados simultaneos se escuchen
 * completos y en orden, en vez de pisarse.
 */
/** Pausa por defecto entre repeticiones del mismo turno. */
export const MS_ENTRE_REPETICIONES = 2000

export class ColaDeAnuncios {
  private pendientes: Array<{ texto: string; opciones: OpcionesAnuncio }> = []
  private hablando = false
  private locutor: Locutor
  private pausaMs: number

  constructor(locutor: Locutor, pausaMs: number = MS_ENTRE_REPETICIONES) {
    this.locutor = locutor
    this.pausaMs = pausaMs
  }

  /** Cuantos anuncios esperan turno para sonar. */
  get pendiente(): number {
    return this.pendientes.length
  }

  encolar(texto: string, opciones: OpcionesAnuncio) {
    // Sin voz en español no se anuncia nada: es preferible el silencio a que
    // una voz inglesa lea el nombre del paciente.
    if (!opciones.voz || opciones.volumen <= 0) return

    this.pendientes.push({ texto, opciones })
    if (!this.hablando) void this.procesar()
  }

  vaciar() {
    this.pendientes = []
  }

  private async procesar() {
    this.hablando = true

    while (this.pendientes.length > 0) {
      const siguiente = this.pendientes.shift()!
      const veces = Math.max(1, Math.min(3, siguiente.opciones.repeticiones))

      for (let i = 0; i < veces; i++) {
        try {
          await this.locutor(siguiente.texto, siguiente.opciones)
        } catch {
          // Si una locucion falla, seguimos con la siguiente: un error de audio
          // no puede dejar la cola trancada.
        }

        // Si ya hay otro turno esperando, no repetimos este: se dice una sola
        // vez y se pasa al siguiente, para no hacer esperar a los demas
        // consultorios detras de una racha de llamados. Solo se repite el
        // turno que quedo solo en la cola (nadie esperando detras).
        if (this.pendientes.length > 0) break

        // Pausa entre repeticiones del MISMO turno, para que el paciente
        // alcance a reaccionar antes de volver a oirlo. Entre turnos distintos
        // no hace falta: ya cambian el codigo y el consultorio.
        if (i < veces - 1) await this.esperar(this.pausaMs)
      }
    }

    this.hablando = false
  }

  private esperar(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/** Campanita de dos tonos antes del anuncio, para que la gente levante la vista. */
export function sonarCampana(volumen: number) {
  if (typeof window === 'undefined') return

  const Contexto = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Contexto) return

  const contexto = new Contexto()
  const ahora = contexto.currentTime

  for (const [indice, frecuencia] of [880, 1174.66].entries()) {
    const oscilador = contexto.createOscillator()
    const ganancia = contexto.createGain()

    oscilador.type = 'sine'
    oscilador.frequency.value = frecuencia
    ganancia.gain.setValueAtTime(0.0001, ahora + indice * 0.18)
    ganancia.gain.exponentialRampToValueAtTime(0.25 * volumen, ahora + indice * 0.18 + 0.02)
    ganancia.gain.exponentialRampToValueAtTime(0.0001, ahora + indice * 0.18 + 0.32)

    oscilador.connect(ganancia).connect(contexto.destination)
    oscilador.start(ahora + indice * 0.18)
    oscilador.stop(ahora + indice * 0.18 + 0.34)
  }

  setTimeout(() => void contexto.close(), 1200)
}

/** Locutor real, sobre `speechSynthesis`. Resuelve cuando termina de hablar. */
export const locutorNavegador: Locutor = (texto, opciones) =>
  new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || !opciones.voz) {
      resolve()
      return
    }

    const mensaje = new SpeechSynthesisUtterance(texto)
    mensaje.voice = opciones.voz
    // Forzamos siempre el acento colombiano. Si la voz es de otra variante del
    // español (ej. es-MX), fijar es-CO empuja al motor hacia una pronunciacion
    // mas cercana; el texto ya viene en español, nunca se pasa una voz inglesa.
    mensaje.lang = 'es-CO'
    mensaje.volume = opciones.volumen
    // Un poco mas lento que el habla normal: se entiende mejor de lejos.
    mensaje.rate = 0.92
    mensaje.pitch = 1

    let terminado = false
    const finalizar = () => {
      if (terminado) return
      terminado = true
      resolve()
    }

    mensaje.onend = finalizar
    mensaje.onerror = finalizar

    // Red de seguridad: algunos navegadores no disparan `onend` si la pestaña
    // pasa a segundo plano, y la cola quedaria trancada para siempre.
    const limite = Math.max(4000, texto.length * 120)
    setTimeout(finalizar, limite)

    window.speechSynthesis.speak(mensaje)
  })

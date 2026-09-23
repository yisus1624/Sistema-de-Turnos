/**
 * Sonido del llamado en la pantalla de la sala de espera (requerimiento
 * seccion 11).
 *
 * POR QUE UN SONIDO Y NO UNA VOZ. Antes esto leia el turno en voz alta con
 * `speechSynthesis`. Se quito a peticion del hospital: cuando varios
 * consultorios pasan paciente casi al tiempo, cada locucion dura varios
 * segundos y hay que decirlas una tras otra para que no se pisen, asi que la
 * cola se va llenando y el audio termina anunciando turnos que en la pantalla
 * ya cambiaron. Ademas la voz dependia de que el equipo tuviera instalada una
 * voz en español, y donde no la habia el llamado quedaba mudo.
 *
 * Una campanita corta e igual para todos resuelve las dos cosas: dura menos de
 * un segundo, suena en cualquier equipo y hace lo unico que se necesita del
 * audio, que es levantar la vista hacia la pantalla. QUE turno es y a que
 * consultorio va lo dice la pantalla, que es donde ya estaba la informacion
 * completa.
 *
 * El nombre del paciente nunca se emite por el altavoz. Con la voz eso era una
 * regla que habia que sostener a mano; con la campana es imposible por
 * construccion.
 */
import { programadorReal, type Programador } from '@/lib/programador'

/**
 * Cuanto dura la campanita, en milisegundos.
 *
 * Son los dos tonos de `sonarCampana`: el segundo arranca a los 0.18 s y se
 * apaga 0.34 s despues. De aqui sale la separacion minima entre campanadas: si
 * dos se pisan, la sala oye un ruido en vez de dos avisos.
 */
export const MS_CAMPANA = 520

/**
 * Cuanto se espera entre una campanada y la siguiente, en milisegundos.
 *
 * Un segundo: la anterior ya termino (dura `MS_CAMPANA`) y todavia queda casi
 * medio segundo de silencio, que es lo que hace que se oigan como DOS avisos y
 * no como uno solo arrastrado. Si dos consultorios pasan paciente al tiempo, la
 * sala oye "ding ... ding" y mira la pantalla las dos veces.
 */
export const MS_SEPARACION = 1000

/**
 * Cuantas campanadas pueden quedar esperando su turno.
 *
 * La cola existe para no perder ningun aviso cuando varios consultorios pasan
 * paciente casi al tiempo; lo normal es que sean dos o tres. Pero el tope hace
 * falta: con diez consultorios llamando en la misma tanda, sonar las diez son
 * diez segundos de campanadas seguidas, y eso la sala ya no lo oye como avisos
 * sino como una alarma.
 *
 * Cinco en espera (seis campanadas contando la que ya sono, unos cinco
 * segundos) cubre de sobra la rafaga real y le pone techo al caso extremo. Lo
 * que se descarta pasado el tope no se pierde del todo: la pantalla ya tiene
 * pintadas todas las casillas que cambiaron, y la sala ya levanto la vista.
 */
export const MAX_EN_COLA = 5

/**
 * Un unico AudioContext para toda la pantalla.
 *
 * Crear uno por llamado (como se hacia antes) es caro y ademas los navegadores
 * limitan cuantos puede tener una pagina: en una rafaga de llamados los
 * ultimos se quedaban sin sonar. La pantalla del televisor queda abierta dias
 * enteros, asi que este es justo el caso que hay que cuidar.
 */
let contextoCompartido: AudioContext | null = null

/**
 * Si el audio llego a estar en marcha en esta pagina. Es la unica pista que
 * deja Chromium (sin `getAutoplayPolicy`) de que el navegador ya permitio
 * sonar: si sono una vez, al volver de segundo plano se puede reanudar solo.
 */
let llegoAEstarEnMarcha = false

function obtenerContexto(): AudioContext | null {
  if (typeof window === 'undefined') return null

  const Contexto =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Contexto) return null

  contextoCompartido ??= new Contexto()
  if (contextoCompartido.state === 'running') llegoAEstarEnMarcha = true

  // El navegador suspende el audio hasta que el usuario interactua con la
  // pagina (salvo en el kiosco con --autoplay-policy=...), y tambien puede
  // suspenderlo si la pestaña queda mucho rato en segundo plano.
  if (contextoCompartido.state === 'suspended') {
    void contextoCompartido.resume().catch(() => {})
  }

  return contextoCompartido
}

/** Si el navegador deja sonar la campana ahora mismo. */
export type EstadoDelAudio = 'permitido' | 'bloqueado' | 'sin_audio'

/**
 * Lo que dice el navegador sobre el audio, tal cual.
 *
 * `politica` es `navigator.getAutoplayPolicy('audiocontext')` donde existe
 * (Firefox y Chrome recientes); `estadoContexto`, el `state` de un
 * AudioContext recien creado, que arranca en 'running' solo si el navegador
 * ya permite sonar sin gesto (el kiosco con --autoplay-policy=...).
 */
export interface SenalesDeAudio {
  politica?: string
  estadoContexto?: string
}

/**
 * Decide si el televisor puede sonar sin que nadie toque nada.
 *
 * La politica declarada manda: es la respuesta explicita del navegador. Sin
 * ella, el estado del contexto es la mejor pista. Pura, para poder probarla.
 */
export function decidirEstadoDelAudio(senales: SenalesDeAudio): EstadoDelAudio {
  if (senales.politica) return senales.politica === 'allowed' ? 'permitido' : 'bloqueado'
  if (!senales.estadoContexto) return 'sin_audio'
  return senales.estadoContexto === 'running' ? 'permitido' : 'bloqueado'
}

type NavegadorConPolitica = Navigator & { getAutoplayPolicy?: (tipo: 'audiocontext') => string }

function politicaDeAutoplay(): string | undefined {
  try {
    return (navigator as NavegadorConPolitica).getAutoplayPolicy?.('audiocontext')
  } catch {
    return undefined
  }
}

/**
 * Si el audio suspendido se puede reanudar sin que nadie toque la pantalla.
 * La politica declarada manda; sin ella (Chromium), vale haber sonado antes.
 */
export function puedeReanudarseSolo(senales: { politica?: string; llegoAEstarEnMarcha: boolean }): boolean {
  if (senales.politica) return senales.politica === 'allowed'
  return senales.llegoAEstarEnMarcha
}

/** El estado del audio en este navegador, ahora. */
export function estadoDelAudioDelNavegador(): EstadoDelAudio {
  if (typeof window === 'undefined') return 'sin_audio'
  return decidirEstadoDelAudio({ politica: politicaDeAutoplay(), estadoContexto: obtenerContexto()?.state })
}

/**
 * Avisa cada vez que el navegador suelta o vuelve a bloquear el audio (por
 * ejemplo, al primer toque en cualquier parte de la pantalla). Devuelve como
 * dejar de escuchar.
 */
export function alCambiarElAudio(avisar: (estado: EstadoDelAudio) => void): () => void {
  const contexto = obtenerContexto()
  if (!contexto) return () => {}
  const escuchar = () => avisar(estadoDelAudioDelNavegador())
  contexto.addEventListener('statechange', escuchar)
  return () => contexto.removeEventListener('statechange', escuchar)
}

/**
 * Intenta soltar el audio. Solo funciona dentro de un gesto de una persona
 * (un toque, una tecla), salvo que el navegador ya lo permita.
 */
export async function desbloquearAudio(): Promise<EstadoDelAudio> {
  await obtenerContexto()?.resume().catch(() => {})
  return estadoDelAudioDelNavegador()
}

/**
 * Campanita de dos tonos del llamado: la misma para todos los consultorios,
 * para que se reconozca de inmediato como "paso un turno".
 */
export function sonarCampana(volumen: number) {
  if (volumen <= 0) return

  // Solo con el audio EN MARCHA. Suspendido, el reloj del contexto esta parado:
  // cada llamado dejaba sus osciladores programados para el mismo instante, y
  // al primer toque sonaban todos a la vez —saturando— tras acumularse en
  // memoria durante dias. Sin audio, la pantalla ya muestra el aviso.
  const contexto = obtenerContexto()
  if (!contexto) return
  if (contexto.state === 'running') {
    programarTonos(contexto, volumen)
    return
  }

  // Suspendido estando PERMITIDO: la pestaña paso por segundo plano y el
  // navegador la durmio. Se reanuda y suena en cuanto termine; si no, la
  // primera campanada al volver se perdia.
  if (!puedeReanudarseSolo({ politica: politicaDeAutoplay(), llegoAEstarEnMarcha })) return
  void contexto
    .resume()
    .then(() => {
      if (contexto.state === 'running') programarTonos(contexto, volumen)
    })
    .catch(() => {})
}

/** Los dos tonos de la campana sobre un contexto en marcha. */
function programarTonos(contexto: AudioContext, volumen: number) {
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
}

/** Lo que la campana necesita para sonar. Se inyecta para poder probarla. */
export type Reproductor = (volumen: number) => void

export type { Programador }

/** Que paso con un llamado que se le entrego a la campana. */
export type ResultadoAnuncio =
  /** Sono en el acto. */
  | 'sono'
  /** Quedo en cola: sonara en cuanto termine la campanada anterior. */
  | 'en-cola'
  /** No suena: pantalla muda, cola llena o el navegador no pudo reproducir. */
  | 'descartado'

/**
 * Campana del llamado: UNA CAMPANADA POR LLAMADO, separadas un segundo.
 *
 * EL BUG QUE RESUELVE. Cuando dos o tres consultorios pasan paciente casi al
 * mismo tiempo, los eventos llegan con milisegundos de diferencia. Si cada uno
 * dispara su campanita en el acto, las tres se solapan nota con nota y la sala
 * oye UN SOLO sonido; y si para evitarlo se deja sonar solo la primera y se
 * callan las demas, los otros dos llamados se quedan sin aviso. Las dos cosas
 * acaban igual: pasaron tres pacientes y la sala conto uno.
 *
 * Por eso hay cola: la primera suena de inmediato y cada siguiente espera
 * `MS_SEPARACION` desde la anterior. La campanada dura `MS_CAMPANA`, asi que
 * nunca se pisan y entre una y otra queda silencio de verdad: se cuentan de
 * oido.
 *
 * El tope de `MAX_EN_COLA` cuida el otro extremo: con diez consultorios
 * llamando en la misma tanda, una ristra larga de campanadas se oye como una
 * alarma y no como avisos.
 *
 * La campana nunca dice QUE turno paso ni a que consultorio ir: eso esta en la
 * pantalla, donde se ven a la vez todas las casillas que cambiaron. El nombre
 * del paciente no sale por el altavoz nunca.
 */
export class CampanaDeLlamado {
  private reproductor: Reproductor
  private separacionMs: number
  private programar: Programador
  /** Volumenes esperando su campanada, en orden de llegada. */
  private cola: number[] = []
  /**
   * Como cancelar la espera en curso. Que NO sea null significa que acaba de
   * sonar una campanada y todavia no se cumplio la separacion: lo que llegue
   * ahora va a la cola en vez de pisarla.
   */
  private cancelarEspera: (() => void) | null = null

  constructor(
    reproductor: Reproductor,
    separacionMs: number = MS_SEPARACION,
    programar: Programador = programadorReal,
  ) {
    this.reproductor = reproductor
    this.separacionMs = separacionMs
    this.programar = programar
  }

  /** Cuantas campanadas quedan esperando. Se comprueba en las pruebas. */
  get pendientes(): number {
    return this.cola.length
  }

  /**
   * Anuncia un llamado.
   *
   * Con el volumen en cero no suena nada y tampoco arranca la espera: la
   * pantalla muda no tiene por que acordarse de nada.
   */
  anunciar(volumen: number): ResultadoAnuncio {
    if (volumen <= 0) return 'descartado'

    // Hay una campanada sonando o recien sonada: esta va detras, no encima.
    if (this.cancelarEspera !== null) {
      if (this.cola.length >= MAX_EN_COLA) return 'descartado'

      this.cola.push(volumen)
      return 'en-cola'
    }

    const sono = this.reproducir(volumen)
    // La espera arranca aunque el audio falle: si el navegador no puede sonar,
    // machacarlo con una campanada por evento no lo va a arreglar.
    this.esperarYSeguir()

    return sono ? 'sono' : 'descartado'
  }

  /**
   * Corta el aviso: olvida lo que quedaba en cola y la espera en curso.
   *
   * Se usa al apagar el sonido y al desmontar la pantalla. Sin esto, quitar el
   * volumen dejaba salir igual las campanadas ya encoladas, y cerrar la
   * pantalla dejaba temporizadores vivos.
   */
  reiniciar() {
    this.cola = []
    if (this.cancelarEspera) {
      this.cancelarEspera()
      this.cancelarEspera = null
    }
  }

  /** Reproduce sin dejar que un fallo de audio tumbe la pantalla. */
  private reproducir(volumen: number): boolean {
    try {
      this.reproductor(volumen)
      return true
    } catch {
      return false
    }
  }

  /**
   * Deja pasar la separacion y, al cumplirse, suelta la siguiente campanada de
   * la cola (y vuelve a esperar). Con la cola vacia queda libre, para que el
   * proximo llamado suene en el acto.
   */
  private esperarYSeguir() {
    this.cancelarEspera = this.programar(() => {
      this.cancelarEspera = null

      const siguiente = this.cola.shift()
      if (siguiente === undefined) return

      this.reproducir(siguiente)
      this.esperarYSeguir()
    }, this.separacionMs)
  }
}

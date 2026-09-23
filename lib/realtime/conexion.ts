/**
 * Una conexion del canal en vivo (SSE), de principio a fin.
 *
 * Vivia dentro del route handler de `app/api/turnos/stream`. Se saco aqui para
 * que la ruta sea una fachada delgada (reserva la plaza, responde) y para poder
 * probar el ciclo de vida de la conexion —latido, reciclado, limpieza— sin Next
 * y sin navegador. El hub llega inyectado: esta pieza no sabe de donde salen
 * los eventos.
 */
import { LATIDO, MS_LATIDO, formatearMensajeSse } from './canal'
import type { EventoTurno } from './hub'
import type { PlazaDelCanal } from './aforo'

/**
 * Cuantos mensajes se le pueden quedar sin leer a un cliente antes de darlo por
 * perdido y cerrarle la conexion.
 *
 * Un televisor con el wifi degradado —no desconectado, solo sin drenar el
 * socket— no dispara ningun error ni suelta su plaza: se queda acumulando en la
 * memoria del servidor todos los latidos y llamados de la jornada. Treinta
 * mensajes son unos diez minutos de latidos; una pantalla sana nunca llega.
 *
 * DETRAS DE NGINX ESTO NO BASTA: nginx drena el stream aunque al otro lado no
 * haya nadie, asi que el margen nunca baja. De eso se encarga el reciclado.
 */
const MENSAJES_SIN_LEER_MAXIMOS = 30

/**
 * Cada cuanto el servidor cierra y deja reabrir cada conexion.
 *
 * POR QUE RECICLAR. Cuando se corta el internet del hospital, las conexiones
 * quedan medio abiertas: ni el servidor ni nginx se enteran, y cada una retenia
 * su plaza del aforo hasta que nginx la daba por muerta, unos quince minutos
 * despues. Las pantallas que volvian se encontraban el aforo lleno de sus
 * propios fantasmas. Cerrando cada conexion cada pocos minutos, ninguna muerta
 * dura mas que eso; las vivas ni lo notan: `EventSource` reconecta solo y el
 * cliente se resincroniza al abrir (ver `crearCanalEnVivo` en `lib/hooks.ts`).
 *
 * Entre cuatro y seis minutos al azar, para que las veinte pantallas del
 * hospital no reconecten todas en el mismo segundo.
 */
export const MS_RECICLADO_MINIMO = 4 * 60_000
export const MS_RECICLADO_MAXIMO = 6 * 60_000

/**
 * Cuanto espera el navegador antes de reconectar tras un cierre, en ms.
 *
 * Sin indicarlo, cada navegador usa su valor (unos tres segundos en Chrome), y
 * la pantalla pasaria ese rato marcando "reconectando" en cada reciclado.
 */
const MS_REINTENTO_DEL_NAVEGADOR = 1000

/** Primer mensaje: fija el reintento del navegador y confirma la conexion. */
const SALUDO = `retry: ${MS_REINTENTO_DEL_NAVEGADOR}\n: conectado\n\n`

/** Momento del reciclado de una conexion. Ver `MS_RECICLADO_MINIMO`. */
export function msHastaReciclar(azar = Math.random()): number {
  return MS_RECICLADO_MINIMO + Math.floor(azar * (MS_RECICLADO_MAXIMO - MS_RECICLADO_MINIMO))
}

export interface OpcionesDeConexion {
  plaza: PlazaDelCanal
  suscribir: (oyente: (evento: EventoTurno) => void) => () => void
  /** Solo para pruebas; en produccion sale de `msHastaReciclar`. */
  msReciclado?: number
}

type Controlador = ReadableStreamDefaultController<Uint8Array>

class ConexionEnVivo {
  private readonly codificador = new TextEncoder()
  private readonly soltadores: Array<() => void> = []
  private controlador: Controlador | null = null
  private readonly opciones: OpcionesDeConexion

  constructor(opciones: OpcionesDeConexion) {
    this.opciones = opciones
  }

  arrancar(controlador: Controlador) {
    this.controlador = controlador
    this.mandar(SALUDO)
    this.soltadores.push(this.opciones.suscribir((evento) => this.mandar(formatearMensajeSse(evento))))
    this.soltadores.push(this.cadaLatido())
    this.soltadores.push(this.alReciclar())
  }

  /**
   * Suelta la suscripcion, los temporizadores y la plaza del aforo.
   *
   * Se llega aqui por varios caminos (el cliente cerro, fallo un envio, toco
   * reciclar) y a veces por dos a la vez: la lista se vacia al recorrerla y
   * `soltar()` de la plaza es idempotente, asi que nada se descuenta dos veces.
   */
  liberar() {
    for (const soltar of this.soltadores.splice(0)) soltar()
    this.opciones.plaza.soltar()
  }

  private cerrar() {
    this.liberar()
    try {
      this.controlador?.close()
    } catch {
      // Ya estaba cerrado: no queda nada que hacer.
    }
  }

  /**
   * Manda un mensaje, y si el cliente no lo esta leyendo, lo suelta.
   *
   * `enqueue` no falla porque nadie lea: encola en la memoria del servidor. El
   * unico indicio es `desiredSize`, que baja a negativo con cada mensaje sin
   * leer (y es null con el stream ya cerrado).
   */
  private mandar(texto: string) {
    const margen = this.controlador?.desiredSize ?? null
    if (margen !== null && margen < -MENSAJES_SIN_LEER_MAXIMOS) {
      this.cerrar()
      return
    }

    try {
      this.controlador?.enqueue(this.codificador.encode(texto))
    } catch {
      this.liberar()
    }
  }

  private cadaLatido(): () => void {
    const latido = setInterval(() => this.mandar(formatearMensajeSse(LATIDO)), MS_LATIDO)
    return () => clearInterval(latido)
  }

  private alReciclar(): () => void {
    const reciclado = setTimeout(() => this.cerrar(), this.opciones.msReciclado ?? msHastaReciclar())
    return () => clearTimeout(reciclado)
  }
}

/**
 * Abre el stream de una conexion ya admitida por el aforo.
 *
 * La plaza se devuelve sola cuando la conexion termina, sea cual sea el motivo.
 */
export function abrirConexionEnVivo(opciones: OpcionesDeConexion): ReadableStream<Uint8Array> {
  const conexion = new ConexionEnVivo(opciones)
  return new ReadableStream<Uint8Array>({
    start: (controlador) => conexion.arrancar(controlador),
    cancel: () => conexion.liberar(),
  })
}

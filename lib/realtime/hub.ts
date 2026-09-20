/**
 * Hub de eventos en tiempo real (en proceso).
 *
 * Usa un `EventEmitter` de Node guardado en `globalThis` para sobrevivir al
 * HMR de desarrollo y a que distintos route handlers importen este modulo de
 * forma independiente (Next.js puede crear multiples instancias de modulo).
 *
 * Sirve como puente entre las acciones del consultorio o la ventanilla
 * (POST /api/turnos/**) y la pantalla de la sala de espera, que se suscribe
 * via Server-Sent Events (SSE) en GET /api/turnos/stream.
 *
 * IMPORTANTE: lo que viaja aqui llega a una pantalla SIN sesion. Por eso los
 * eventos cargan `CasillaPantalla`, que por construccion no tiene ningun dato
 * del paciente: solo el turno, el consultorio y el doctor.
 *
 * NOTA: esto funciona en un unico proceso/servidor. Si en produccion se
 * despliega con varias instancias, habria que migrar a un bus compartido
 * (Redis pub/sub, etc.). Para el despliegue en una sola VPS es suficiente.
 */
import { EventEmitter } from 'events'
import { topeDeConexionesEnVivo } from './aforo'
import type { CasillaPantalla } from '@/lib/turnos/types'

export type EventoTurno =
  /** Se llamo (o se repitio) un turno: la pantalla lo destaca y lo anuncia. */
  | { tipo: 'turno.llamado'; casilla: CasillaPantalla; repetido: boolean }
  /** El consultorio quedo libre: la pantalla apaga esa casilla. */
  | { tipo: 'modulo.liberado'; moduloId: string }
  /**
   * Cambio la fila de espera (una llegada registrada en admisiones, un turno
   * nuevo de ventanilla): quien atiende esa fila recarga sus pendientes.
   *
   * No lleva el turno ni nada del paciente a proposito: solo dice QUE fila se
   * movio, porque este mismo canal lo escucha la pantalla sin sesion.
   */
  | { tipo: 'fila.cambiada'; servicioId: string; profesionalId: string | null }
  /**
   * El administrador guardo la configuracion: la pantalla vuelve a pedir su
   * estado y se repinta con lo nuevo.
   *
   * SIN ESTO EL CAMBIO TARDABA HASTA UN MINUTO. El televisor solo se
   * resincroniza cada `MS_RESINCRONIZAR`, asi que al cambiarle el diseño —o el
   * mensaje del pie, o el volumen— las salas seguian con lo anterior durante
   * casi un minuto, sin ninguna señal de que algo estuviera en camino. Quien
   * acababa de guardar lo leia como que no habia funcionado, volvia a guardar,
   * y asi.
   *
   * No lleva la configuracion dentro a proposito: este canal lo escucha la
   * pantalla de la sala de espera, que no tiene sesion. El evento solo dice
   * "vuelve a preguntar", y lo que se le responde ya pasa por la ruta publica,
   * que decide que sale hacia alla.
   */
  | { tipo: 'configuracion.cambiada' }

const EVENTO = 'turno'

/**
 * Oyentes que no son conexiones de navegador: hoy solo la cache de la pantalla
 * publica (`lib/turnos/pantalla-cacheada.ts`), que se suscribe una vez y se
 * queda. Se deja holgura para no tener que tocar esto al añadir otro.
 */
const MARGEN_DE_OYENTES = 10

class RealtimeHub {
  private emitter = new EventEmitter()

  constructor() {
    /*
      El tope de oyentes sale del aforo del canal, no de un numero escrito aqui.

      Cada conexion SSE engancha un oyente (mas el permanente de la cache de la
      pantalla, y de ahi el margen). Estaba fijo en 100 mientras el aforo
      admitia 200: pasando de cien televisores y consultorios conectados, Node
      avisaba de una fuga que no existia —las conexiones estaban admitidas a
      proposito— y ensuciaba el log con trazas en cada suscripcion. Ahora subir
      el aforo con `TURNOS_MAX_CANAL_EN_VIVO` sube los dos a la vez.
    */
    this.emitter.setMaxListeners(topeDeConexionesEnVivo() + MARGEN_DE_OYENTES)
  }

  publish(evento: EventoTurno) {
    this.emitter.emit(EVENTO, evento)
  }

  subscribe(listener: (evento: EventoTurno) => void): () => void {
    this.emitter.on(EVENTO, listener)
    return () => this.emitter.off(EVENTO, listener)
  }
}

declare global {
  var __turnosRealtimeHub: RealtimeHub | undefined
}

export const realtimeHub: RealtimeHub = globalThis.__turnosRealtimeHub ?? new RealtimeHub()

// Se guarda SIEMPRE, tambien en produccion. Guardarlo solo en desarrollo
// contradecia el motivo por el que existe: si Next evalua este modulo en dos
// contextos, quien publica el llamado y quien lo escucha por SSE terminan en
// hubs distintos y la pantalla de la sala de espera se queda congelada,
// mostrando turnos viejos sin ningun error visible.
globalThis.__turnosRealtimeHub = realtimeHub

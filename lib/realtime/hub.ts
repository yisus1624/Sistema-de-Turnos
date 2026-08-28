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
 * eventos cargan `CasillaPantalla`, que ya trae el nombre del paciente
 * enmascarado; el nombre completo nunca se publica.
 *
 * NOTA: esto funciona en un unico proceso/servidor. Si en produccion se
 * despliega con varias instancias, habria que migrar a un bus compartido
 * (Redis pub/sub, etc.). Para el despliegue en una sola VPS es suficiente.
 */
import { EventEmitter } from 'events'
import type { CasillaPantalla } from '@/lib/turnos/types'

export type EventoTurno =
  /** Se llamo (o se repitio) un turno: la pantalla lo destaca y lo anuncia. */
  | { tipo: 'turno.llamado'; casilla: CasillaPantalla; repetido: boolean }
  /** El consultorio quedo libre: la pantalla apaga esa casilla. */
  | { tipo: 'modulo.liberado'; moduloId: string }

const EVENTO = 'turno'

class RealtimeHub {
  private emitter = new EventEmitter()

  constructor() {
    // Puede haber varias pantallas y consultorios conectados a la vez.
    this.emitter.setMaxListeners(100)
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

if (process.env.NODE_ENV !== 'production') {
  globalThis.__turnosRealtimeHub = realtimeHub
}

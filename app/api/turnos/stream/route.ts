/**
 * Server-Sent Events (SSE) para la pantalla publica.
 *
 * Emite un evento cada vez que el hub en memoria (`lib/realtime/hub.ts`)
 * publica un cambio de turno (llamado, repetido, atendido, ausente,
 * generado). Se envia tambien un "ping" periodico como comentario SSE para
 * mantener la conexion viva a traves de proxies/balanceadores.
 */
import { realtimeHub, type EventoTurno } from '@/lib/realtime/hub'

export const dynamic = 'force-dynamic'

function formatearEvento(evento: EventoTurno) {
  return `data: ${JSON.stringify(evento)}\n\n`
}

export async function GET() {
  const encoder = new TextEncoder()

  let unsubscribe: (() => void) | null = null
  let ping: ReturnType<typeof setInterval> | null = null

  /**
   * Suelta la suscripcion y el temporizador.
   *
   * Se llama tanto desde `cancel()` (el cliente cerro la pestaña) como en
   * cuanto un envio falla. Sin lo segundo, una pantalla que se desconecta de
   * golpe podia dejar el intervalo latiendo y el listener enganchado para
   * siempre; con un televisor que se apaga y se enciende todos los dias, esas
   * conexiones muertas se van acumulando en el servidor.
   */
  const limpiar = () => {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    if (ping) {
      clearInterval(ping)
      ping = null
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(': conectado\n\n'))

      unsubscribe = realtimeHub.subscribe((evento) => {
        try {
          controller.enqueue(encoder.encode(formatearEvento(evento)))
        } catch {
          // El controller ya se cerro: el cliente se desconecto.
          limpiar()
        }
      })

      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          limpiar()
        }
      }, 20000)
    },
    cancel() {
      limpiar()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

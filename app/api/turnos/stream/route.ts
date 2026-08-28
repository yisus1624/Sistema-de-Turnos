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

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(': conectado\n\n'))

      unsubscribe = realtimeHub.subscribe((evento) => {
        try {
          controller.enqueue(encoder.encode(formatearEvento(evento)))
        } catch {
          // El controller ya pudo haberse cerrado si el cliente se desconecto.
        }
      })

      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          // Ignorar: se limpia en cancel().
        }
      }, 20000)
    },
    cancel() {
      if (unsubscribe) unsubscribe()
      if (ping) clearInterval(ping)
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

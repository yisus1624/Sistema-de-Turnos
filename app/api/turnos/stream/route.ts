/**
 * Server-Sent Events (SSE) para las pantallas que se actualizan solas.
 *
 * Emite un evento cada vez que el hub en memoria (`lib/realtime/hub.ts`)
 * publica un cambio (llamado, repetido, consultorio liberado, fila movida), y
 * un LATIDO periodico que mantiene viva la conexion a traves de proxies y
 * balanceadores.
 *
 * El latido va como evento CON DATOS, no como comentario SSE (ver
 * `lib/realtime/canal.ts`): los comentarios no llegan a `onmessage`, asi que el
 * cliente no podria notar que dejaron de llegar, que es justo como se detecta
 * una conexion muerta en silencio.
 */
import { realtimeHub } from '@/lib/realtime/hub'
import { LATIDO, MS_LATIDO, formatearMensajeSse } from '@/lib/realtime/canal'

export const dynamic = 'force-dynamic'

export async function GET() {
  const encoder = new TextEncoder()

  let unsubscribe: (() => void) | null = null
  let latido: ReturnType<typeof setInterval> | null = null

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
    if (latido) {
      clearInterval(latido)
      latido = null
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(': conectado\n\n'))

      unsubscribe = realtimeHub.subscribe((evento) => {
        try {
          controller.enqueue(encoder.encode(formatearMensajeSse(evento)))
        } catch {
          // El controller ya se cerro: el cliente se desconecto.
          limpiar()
        }
      })

      latido = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(formatearMensajeSse(LATIDO)))
        } catch {
          limpiar()
        }
      }, MS_LATIDO)
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

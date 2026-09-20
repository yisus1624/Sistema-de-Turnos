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
import { ocuparPlaza, tocaAnotarElRechazo } from '@/lib/realtime/aforo'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'

export const dynamic = 'force-dynamic'

/**
 * Cuanto se le pide al cliente que espere antes de reintentar, en segundos.
 *
 * Corto a proposito: el aforo se llena por una avalancha, no por una averia, y
 * una pantalla legitima que llego en mal momento tiene que volver a entrar en
 * cuanto se libere una plaza, no dentro de varios minutos.
 */
const SEGUNDOS_PARA_REINTENTAR = 15

/** Respuesta al que no cabe. Ver `lib/realtime/aforo.ts`. */
function canalLleno() {
  return Response.json(
    {
      error:
        'La pantalla no se puede conectar en este momento porque el servidor ya atiende todas ' +
        'las conexiones en vivo que admite. Vuelve a intentarlo en unos segundos; si sigue ' +
        'pasando, avisa a sistemas.',
    },
    { status: 503, headers: { 'Retry-After': String(SEGUNDOS_PARA_REINTENTAR) } },
  )
}

export async function GET() {
  const encoder = new TextEncoder()

  // La IP viene en null si no hay proxy declarado: entonces solo cuenta el
  // tope global (ver `contextoPeticion` y `ocuparPlaza`).
  const { ip } = await contextoPeticion()
  const reserva = ocuparPlaza(ip)

  if (!reserva.admitida) {
    // Anotado con freno: escribir un apunte por cada conexion rechazada
    // convertiria la avalancha en una avalancha de escrituras contra la misma
    // base que se esta protegiendo (ver `tocaAnotarElRechazo`).
    if (tocaAnotarElRechazo()) {
      await registrarEvento({
        tipo: EVENTOS.CANAL_EN_VIVO_RECHAZADO,
        exito: false,
        ip,
        detalle: { motivo: reserva.motivo },
      })
    }
    return canalLleno()
  }

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
   *
   * Tambien devuelve la plaza del aforo. `soltar()` es idempotente, asi que no
   * importa que esto se ejecute dos veces por la misma conexion —pasa cuando
   * el cliente cierra justo despues de que falle un envio—: la plaza se
   * descuenta una sola vez.
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
    reserva.plaza.soltar()
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

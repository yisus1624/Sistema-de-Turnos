/**
 * Server-Sent Events (SSE) para las pantallas que se actualizan solas.
 *
 * Fachada delgada: reserva una plaza en el aforo (`lib/realtime/aforo.ts`) y,
 * si cabe, entrega el stream de `lib/realtime/conexion.ts`, que se encarga del
 * latido, del reciclado periodico y de devolver la plaza al terminar.
 *
 * El latido va como evento CON DATOS, no como comentario SSE (ver
 * `lib/realtime/canal.ts`): los comentarios no llegan a `onmessage`, asi que el
 * cliente no podria notar que dejaron de llegar, que es justo como se detecta
 * una conexion muerta en silencio.
 */
import { realtimeHub } from '@/lib/realtime/hub'
import { ocuparPlaza, tocaAnotarElRechazo, type MotivoDeRechazo } from '@/lib/realtime/aforo'
import { abrirConexionEnVivo } from '@/lib/realtime/conexion'
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

/**
 * Deja constancia del rechazo, con freno: un apunte por cada conexion rechazada
 * convertiria la avalancha en una avalancha de escrituras contra la misma base
 * que se esta protegiendo (ver `tocaAnotarElRechazo`).
 */
async function anotarRechazo(ip: string | null, motivo: MotivoDeRechazo) {
  if (!tocaAnotarElRechazo()) return
  await registrarEvento({ tipo: EVENTOS.CANAL_EN_VIVO_RECHAZADO, exito: false, ip, detalle: { motivo } })
}

export async function GET() {
  // La IP viene en null si no hay proxy declarado: entonces solo cuenta el
  // tope global (ver `contextoPeticion` y `ocuparPlaza`).
  const { ip } = await contextoPeticion()
  const reserva = ocuparPlaza(ip)

  if (!reserva.admitida) {
    await anotarRechazo(ip, reserva.motivo)
    return canalLleno()
  }

  const stream = abrirConexionEnVivo({
    plaza: reserva.plaza,
    suscribir: (oyente) => realtimeHub.subscribe(oyente),
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

/**
 * El estado del televisor de la sala de espera, con una cache de un segundo y
 * medio.
 *
 * POR QUE. `GET /api/turnos/pantalla` es publico, no pide sesion y es la ruta
 * mas pedida del sistema: la piden el televisor, el monitor del administrador
 * y cada consultorio que se resincroniza. Cada peticion baja hasta la base. Un
 * bucle de peticiones —que puede hacer cualquiera desde la red del hospital, y
 * tambien un televisor mal configurado— agota el pool de conexiones de Prisma,
 * y ese pool es el MISMO que usa el inicio de sesion: se cae la pantalla y de
 * paso nadie puede entrar a trabajar.
 *
 * POR QUE NO RETRASA NINGUN LLAMADO. Lo que avisa de un llamado en el
 * televisor NO es esta consulta, sino el canal en vivo (`lib/realtime/hub.ts`,
 * SSE): el evento trae la casilla ya pintada y dispara la campana en el acto.
 * Esta consulta es la resincronizacion de fondo —trae la configuracion, los
 * consultorios nuevos y el cambio de dia—, y ahi un segundo y medio no se nota.
 *
 * LA EXCEPCION, Y POR ESO LA CACHE SE INVALIDA. Hay un caso en que la pantalla
 * SI depende de esta consulta al instante: cuando llega el llamado de un
 * consultorio que todavia no esta en la cuadricula (`app/pantalla/page.tsx`
 * pide el estado completo para traer la casilla nueva). Servirle ahi una foto
 * anterior al llamado deja a la sala oyendo la campana sin ver el turno. Por
 * eso cualquier evento del hub tira la foto guardada: lo que publica el hub es
 * exactamente lo que cambia esta pantalla.
 */
import { realtimeHub } from '@/lib/realtime/hub'
import { turnoRepository } from './repositorio'
import type { EstadoPantalla } from './types'

/**
 * Cuanto vale la foto guardada.
 *
 * Suficiente para que una rafaga de peticiones baje a la base UNA vez, y
 * bastante menos que la resincronizacion periodica del televisor, asi que
 * ningun refresco normal se sirve de una foto vieja.
 */
const MS_VIGENCIA = 1500

interface CachePantalla {
  /**
   * Se guarda la PROMESA, no el resultado.
   *
   * Asi varias peticiones que llegan a la vez —el caso que hay que aguantar—
   * comparten la misma consulta en vuelo en vez de abrir una conexion cada
   * una, que es justo lo que agota el pool.
   */
  foto: Promise<EstadoPantalla> | null
  expiraEn: number
}

declare global {
  var __turnosCachePantalla: CachePantalla | undefined
}

// En `globalThis` como el hub y el aforo: si Next evalua este modulo en dos
// contextos, cada uno tendria su cache y la invalidacion del hub solo limpiaria
// una de las dos.
const cache: CachePantalla = globalThis.__turnosCachePantalla ?? { foto: null, expiraEn: 0 }
globalThis.__turnosCachePantalla = cache

function invalidar() {
  cache.foto = null
  cache.expiraEn = 0
}

let suscrito = false

/**
 * Se engancha una sola vez al canal: cada evento (llamado, repetido,
 * consultorio liberado, fila movida) deja la foto obsoleta al instante.
 */
function vigilarElCanal() {
  if (suscrito) return
  suscrito = true
  realtimeHub.subscribe(invalidar)
}

export async function estadoPantallaCacheado(): Promise<EstadoPantalla> {
  vigilarElCanal()

  if (cache.foto && Date.now() < cache.expiraEn) return cache.foto

  const foto = turnoRepository.estadoPantalla()
  cache.foto = foto
  cache.expiraEn = Date.now() + MS_VIGENCIA

  // Una consulta fallida no se guarda: si no, el fallo se repetiria servido de
  // memoria durante el segundo y medio siguiente a todo el que preguntara.
  foto.catch(invalidar)

  return foto
}

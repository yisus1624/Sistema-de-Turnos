/**
 * Seguridad basica del sistema (requerimiento seccion 17).
 *
 * Cubre dos cosas: limitar los intentos de inicio de sesion y dejar un
 * "registro de actividades importantes".
 *
 * TEMPORAL: ambas cosas viven en memoria del proceso, igual que el resto de la
 * capa de datos, porque el sistema todavia no tiene una fuente persistente
 * (ver `lib/hospital/README.md`). Cuando se defina, el registro deberia
 * enviarse a esa fuente sin cambiar quien lo llama.
 */
import { headers } from 'next/headers'

export interface EventoSeguridad {
  fecha: string
  tipo: string
  exito: boolean
  usuarioId?: string | null
  identificador?: string | null
  ip?: string | null
  detalle?: Record<string, unknown>
}

/**
 * Cuantos eventos se conservan.
 *
 * Eran 500, y con eso no alcanzaba ni para un dia: entre citas, llegadas y
 * cierres, un hospital que atiende un par de cientos de pacientes barria el
 * registro antes de cerrar la jornada, y con el se iban los intentos de entrada
 * fallidos, que es lo que de verdad hay que poder revisar despues.
 *
 * NO SE AUDITA cada llamado ni cada repeticion: eso ya queda entero en el
 * propio turno (quien llamo, a que hora, cuantas veces, quien lo cerro), y
 * apuntarlo aqui solo serviria para desplazar lo demas.
 *
 * TEMPORAL, como el resto de la capa de datos: esto vive en memoria y se pierde
 * al reiniciar. Un registro de auditoria de verdad tiene que ir a la fuente
 * persistente del hospital (ver `lib/hospital/README.md`); mientras tanto, el
 * tope solo evita que el proceso crezca sin limite.
 */
const MAX_EVENTOS = 5000

declare global {
  var __turnosEventosSeguridad: EventoSeguridad[] | undefined
  var __turnosIntentos: Map<string, { conteo: number; expiraEn: number }> | undefined
}

const eventos: EventoSeguridad[] = globalThis.__turnosEventosSeguridad ?? []
const intentos: Map<string, { conteo: number; expiraEn: number }> =
  globalThis.__turnosIntentos ?? new Map()

// Se guardan SIEMPRE, tambien en produccion. Antes solo en desarrollo, y eso
// dejaba el limite de intentos sin efecto donde de verdad importa: si Next
// evalua este modulo en otro contexto, el contador de intentos fallidos
// arranca de cero y la proteccion contra fuerza bruta del inicio de sesion
// deja de contar.
globalThis.__turnosEventosSeguridad = eventos
globalThis.__turnosIntentos = intentos

/**
 * Si hay un proxy de confianza delante de la aplicacion.
 *
 * La IP del cliente NO la ve Next.js: solo llega si el proxy la escribe en la
 * cabecera `X-Forwarded-For`. Y una cabecera la pone quien quiera: sin un proxy
 * delante que la SOBRESCRIBA, cualquiera puede mandar la suya e inventarse una
 * IP distinta en cada intento.
 *
 * Por eso hay que declararlo a mano, poniendo TURNOS_CONFIAR_PROXY=1 en el
 * entorno, y solo cuando de verdad haya un proxy inverso (nginx, Caddy,
 * Apache) que sea el UNICO camino hacia la aplicacion. Adivinarlo no se puede:
 * la peticion se ve igual venga del proxy o del atacante.
 */
export const confiarEnProxy = process.env.TURNOS_CONFIAR_PROXY === '1'

/**
 * Datos de la peticion para el registro y los limites de intentos.
 *
 * `ip` viene en null cuando no hay proxy declarado. Eso es a proposito y es mas
 * honesto que apuntar una IP inventada: antes se guardaba la de la cabecera tal
 * cual, asi que el registro de actividad mostraba como origen de un intento
 * fallido la IP que el propio atacante hubiera escrito, y el limite por IP se
 * saltaba cambiandola en cada peticion. Un dato que el atacante controla no
 * sirve ni para bloquear ni para investigar despues.
 *
 * Lo que de verdad frena la fuerza bruta es el limite POR USUARIO, que no
 * depende de esto.
 */
export async function contextoPeticion() {
  const cabeceras = await headers()
  const agente = cabeceras.get('user-agent')

  if (!confiarEnProxy) return { ip: null, agente }

  const reenviado = cabeceras.get('x-forwarded-for')
  // El primero de la lista es el cliente; los siguientes son los proxies por
  // los que paso.
  const ip = reenviado?.split(',')[0]?.trim() || cabeceras.get('x-real-ip') || null

  return { ip, agente }
}

export function registrarEvento(evento: Omit<EventoSeguridad, 'fecha'>) {
  eventos.unshift({ ...evento, fecha: new Date().toISOString() })
  if (eventos.length > MAX_EVENTOS) eventos.length = MAX_EVENTOS

  if (!evento.exito) {
    console.warn('[seguridad]', evento.tipo, {
      identificador: evento.identificador,
      ip: evento.ip,
      ...evento.detalle,
    })
  }
}

export function listarEventos(limite = 100): EventoSeguridad[] {
  return eventos.slice(0, limite)
}

/**
 * Limita cuantas veces se puede repetir una accion por identificador dentro de
 * una ventana de tiempo. Evita fuerza bruta contra el inicio de sesion.
 */
/**
 * Purga las ventanas ya vencidas.
 *
 * Sin esto el mapa crece para siempre: una entrada por cada IP y por cada
 * usuario que alguna vez intento entrar. En un servidor que lleva meses
 * levantado eso es una fuga de memoria lenta pero segura.
 */
function purgarVencidos(ahora: number) {
  for (const [clave, ventana] of intentos) {
    if (ventana.expiraEn <= ahora) intentos.delete(clave)
  }
}

let ultimaPurga = 0

export function limitarIntentos(
  accion: string,
  identificador: string,
  limite: number,
  ventanaMs: number,
) {
  const clave = `${accion}:${identificador.trim().toLowerCase() || 'desconocido'}`
  const ahora = Date.now()

  // Barrido periodico, no en cada llamada: recorrer el mapa entero en cada
  // intento de login seria peor que la fuga que evita.
  if (ahora - ultimaPurga > 60_000) {
    purgarVencidos(ahora)
    ultimaPurga = ahora
  }

  const actual = intentos.get(clave)

  if (!actual || actual.expiraEn <= ahora) {
    intentos.set(clave, { conteo: 1, expiraEn: ahora + ventanaMs })
    return { permitido: true, reintentarEnSegundos: 0 }
  }

  actual.conteo += 1
  return {
    permitido: actual.conteo <= limite,
    reintentarEnSegundos: Math.max(1, Math.ceil((actual.expiraEn - ahora) / 1000)),
  }
}

/**
 * Borra la cuenta de intentos de un identificador. Se llama cuando la accion
 * SALE BIEN.
 *
 * Sin esto el limite contaba tambien los aciertos, asi que no medía "cuantas
 * veces han fallado" sino "cuantas veces se ha usado": un mostrador donde
 * varias personas entran con la misma cuenta se bloqueaba solo a media mañana,
 * sin que nadie hubiera escrito mal una contrasena. Contando unicamente los
 * fallos, el limite frena la fuerza bruta —que por definicion falla— y deja
 * trabajar a quien acierta.
 */
export function limpiarIntentos(accion: string, identificador: string) {
  intentos.delete(`${accion}:${identificador.trim().toLowerCase() || 'desconocido'}`)
}

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

const MAX_EVENTOS = 500

declare global {
  var __turnosEventosSeguridad: EventoSeguridad[] | undefined
  var __turnosIntentos: Map<string, { conteo: number; expiraEn: number }> | undefined
}

const eventos: EventoSeguridad[] = globalThis.__turnosEventosSeguridad ?? []
const intentos: Map<string, { conteo: number; expiraEn: number }> =
  globalThis.__turnosIntentos ?? new Map()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__turnosEventosSeguridad = eventos
  globalThis.__turnosIntentos = intentos
}

export async function contextoPeticion() {
  const cabeceras = await headers()
  const reenviado = cabeceras.get('x-forwarded-for')
  return {
    ip: reenviado?.split(',')[0]?.trim() || cabeceras.get('x-real-ip') || 'desconocida',
    agente: cabeceras.get('user-agent'),
  }
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
export function limitarIntentos(
  accion: string,
  identificador: string,
  limite: number,
  ventanaMs: number,
) {
  const clave = `${accion}:${identificador.trim().toLowerCase() || 'desconocido'}`
  const ahora = Date.now()
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

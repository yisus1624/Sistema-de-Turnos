/**
 * EL HOSPITAL DE DEMOSTRACION Y QUIEN DECIDE CUAL SE USA.
 *
 * Una cuenta marcada como de demostracion (`esDemostracion` en usuarios) ve el
 * sistema entero —admisiones, consultorios, pantalla, simulacion de carga—,
 * pero contra un hospital de mentira que vive en la memoria del servidor:
 * once consultorios, once doctores por jornada y pacientes inventados (ver
 * `sembrarDemostracion`). Nada de lo que hace llega a la base real, y sus
 * llamados viajan por un canal en vivo APARTE, asi que nunca suenan en un
 * televisor de las salas.
 *
 * COMO SE DECIDE, en este orden:
 *   1. un mundo forzado con `enMundo` (rutas que ya saben cual es);
 *   2. el enlace (o PIN) de doctor, que MANDA si viene: los de demostracion
 *      empiezan con `PREFIJO_TOKEN_DEMOSTRACION`, porque el consultorio entra
 *      sin sesion, y uno real es real aunque haya una sesion demo abierta;
 *   3. la sesion: si es de una cuenta de demostracion, el de demostracion;
 *   4. todo lo demas —sin sesion, fuera de una peticion, cualquier fallo— es
 *      el hospital real. El error seguro es el de siempre: nunca puede caer
 *      una peticion real en el mundo de mentira por no poder leer la sesion.
 *
 * Se pierde al reiniciar el servidor y vuelve a sembrarse solo. Es una demo.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { isAuthSessionCookie } from '@/lib/auth-cookies'
import { crearHubAparte, realtimeHub, type RealtimeHub } from '@/lib/realtime/hub'
import { estadoNuevo, InMemoryTurnoRepository, sembrarDemostracion } from '@/lib/turnos/in-memory-repository'
import { turnoRepository as enPostgres } from '@/lib/turnos/prisma-repository'
import type { TurnoRepository } from '@/lib/turnos/repository'

/** Con que empiezan los enlaces de doctor del hospital de demostracion. */
export const PREFIJO_TOKEN_DEMOSTRACION = 'demo_'

/** La cookie y la cabecera con que entra el consultorio (ver `proxy.ts`). */
const COOKIE_CONSULTORIO = 'turnos_consultorio'
const CABECERA_CONSULTORIO = 'x-consultorio-token'

export interface Mundo {
  demostracion: boolean
  repositorio: TurnoRepository
  hub: RealtimeHub
}

interface Demostracion {
  repositorio: InMemoryTurnoRepository
  hub: RealtimeHub
}

declare global {
  var __turnosDemostracion: Demostracion | undefined
}

/** Se crea la primera vez que alguien lo pide, y se guarda como el resto (HMR, varios contextos). */
function demostracion(): Demostracion {
  if (!globalThis.__turnosDemostracion) {
    const hub = crearHubAparte()
    globalThis.__turnosDemostracion = { hub, repositorio: repositorioDeDemostracion(hub) }
  }
  return globalThis.__turnosDemostracion
}

export const MUNDO_REAL: Mundo = { demostracion: false, repositorio: enPostgres, hub: realtimeHub }

export function mundoDeDemostracion(): Mundo {
  const { repositorio, hub } = demostracion()
  return { demostracion: true, repositorio, hub }
}

const forzado = new AsyncLocalStorage<Mundo>()

/** Corre `tarea` en un mundo dado, sin mirar la sesion. */
export function enMundo<T>(mundo: Mundo, tarea: () => T): T {
  return forzado.run(mundo, tarea)
}

/**
 * Lo que se decidio por cada sesion, unos segundos.
 *
 * Leer la sesion revalida la cuenta contra la base (ver `lib/auth.ts`), y el
 * repositorio se consulta varias veces por peticion: sin esto, cada llamada al
 * repositorio seria una consulta mas a la tabla de usuarios. La clave es la
 * cookie entera, asi que una sesion nueva nunca hereda lo de otra.
 */
const MS_RECORDAR = 10_000
const MAXIMO_RECORDADAS = 500
const recordadas = new Map<string, { demostracion: boolean; hasta: number }>()

async function sesionEsDeDemostracion(clave: string): Promise<boolean> {
  const recordada = recordadas.get(clave)
  if (recordada && recordada.hasta > Date.now()) return recordada.demostracion

  const sesion = await auth()
  const demostracion = sesion?.user?.demostracion === true
  if (recordadas.size >= MAXIMO_RECORDADAS) recordadas.clear()
  recordadas.set(clave, { demostracion, hasta: Date.now() + MS_RECORDAR })
  return demostracion
}

/** Las cookies de la cabecera, por nombre. */
function leerCookies(cruda: string): Map<string, string> {
  const galletas = new Map<string, string>()
  for (const parte of cruda.split(';')) {
    const corte = parte.indexOf('=')
    if (corte <= 0) continue
    const nombre = parte.slice(0, corte).trim()
    let valor = parte.slice(corte + 1).trim()
    try {
      valor = decodeURIComponent(valor)
    } catch {
      // Se deja tal cual: una cookie ilegible no es de demostracion.
    }
    galletas.set(nombre, valor)
  }
  return galletas
}

/** Si esta peticion es de la demostracion. Ver el orden en la cabecera del archivo. */
export async function esPeticionDeDemostracion(): Promise<boolean> {
  try {
    const cabeceras = await headers()
    const galletas = leerCookies(cabeceras.get('cookie') ?? '')
    const token = galletas.get(COOKIE_CONSULTORIO) ?? cabeceras.get(CABECERA_CONSULTORIO) ?? ''
    // Con enlace o PIN de medico, MANDA EL TOKEN: uno real es del hospital
    // real aunque en ese navegador haya abierta una sesion de demostracion.
    if (token) return token.startsWith(PREFIJO_TOKEN_DEMOSTRACION)

    // Sin cookie de sesion no hay sesion que leer: la pantalla de la sala y
    // cualquier peticion anonima van directo al hospital real.
    const deSesion = [...galletas].filter(([nombre]) => isAuthSessionCookie(nombre)).map(([, valor]) => valor)
    if (deSesion.length === 0) return false
    return await sesionEsDeDemostracion(deSesion.join(';'))
  } catch {
    // Fuera de una peticion (tareas programadas) o sesion ilegible: el real.
    return false
  }
}

export async function mundoActual(): Promise<Mundo> {
  const elegido = forzado.getStore()
  if (elegido) return elegido
  return (await esPeticionDeDemostracion()) ? mundoDeDemostracion() : MUNDO_REAL
}

/** Vuelve a sembrar el hospital de demostracion entero (catalogo, citas, turnos, enlaces). */
export function reiniciarDemostracion(): void {
  // El mismo canal: las pantallas de demostracion abiertas siguen conectadas
  // y se resincronizan con el aviso.
  const { hub } = demostracion()
  globalThis.__turnosDemostracion = { hub, repositorio: repositorioDeDemostracion(hub) }
  hub.publish({ tipo: 'datos.reiniciados' })
}

function repositorioDeDemostracion(hub: RealtimeHub): InMemoryTurnoRepository {
  return new InMemoryTurnoRepository({
    estado: estadoNuevo(sembrarDemostracion),
    hub,
    prefijoToken: PREFIJO_TOKEN_DEMOSTRACION,
  })
}

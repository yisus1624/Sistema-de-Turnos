/**
 * Limitador de intentos en memoria: cuantas veces paso algo por clave dentro
 * de una ventana de tiempo.
 *
 * Vivia dentro de `registro.ts`, mezclado con el registro de actividad, que es
 * otra cosa (el registro va a la base y se conserva; esto es una ventana de
 * minutos contra la fuerza bruta y esta bien que se pierda al reiniciar).
 *
 * Dos formas de usarlo:
 *   - `limitarIntentos`: cuenta cada uso y dice si se paso (frenos de ritmo,
 *     como las consultas caras).
 *   - `superaFallos` + `apuntarFallo`: mirar sin contar, y contar solo cuando
 *     algo FALLA (inicio de sesion, enlaces de consultorio). Asi un uso normal
 *     no gasta cupo y el acierto de uno no borra los fallos de otro.
 */

import { createHash } from 'node:crypto'

interface Ventana {
  conteo: number
  expiraEn: number
}

declare global {
  var __turnosIntentos: Map<string, Ventana> | undefined
}

// En `globalThis` y SIEMPRE, tambien en produccion: si Next evalua este modulo
// en otro contexto, un contador a medias deja de proteger.
const intentos: Map<string, Ventana> = globalThis.__turnosIntentos ?? new Map()
globalThis.__turnosIntentos = intentos

/**
 * La clave guarda un HASH del identificador, no el texto.
 *
 * El identificador lo escribe quien hace la peticion (un usuario de login, un
 * token de consultorio). Recortarlo no bastaba: en V8 un trozo recortado sigue
 * reteniendo el texto original entero, y doscientos intentos con un usuario de
 * un mega retenian doscientos megas. El hash mide siempre lo mismo.
 */
function claveDe(accion: string, identificador: string): string {
  const normalizado = identificador.trim().toLowerCase() || 'desconocido'
  return `${accion}:${createHash('sha256').update(normalizado).digest('base64url')}`
}

/**
 * Cuantas ventanas se guardan como maximo.
 *
 * La purga solo borra las ventanas YA VENCIDAS, y las claves pueden salir de lo
 * que manda quien hace la peticion (un token inventado por intento). Cincuenta
 * mil son unos pocos megas y quedan muy por encima de cualquier uso real: si se
 * llega, no es trabajo, es una avalancha.
 */
export const MAXIMO_INTENTOS_EN_MEMORIA = 50_000

/** Cuantas se tiran de golpe al llenarse: un barrido cada tanto, no en cada peticion. */
const DESALOJO_POR_TANDA = MAXIMO_INTENTOS_EN_MEMORIA / 10

let ultimaPurga = 0

function purgarVencidos(ahora: number) {
  for (const [clave, ventana] of intentos) {
    if (ventana.expiraEn <= ahora) intentos.delete(clave)
  }
  ultimaPurga = ahora
}

/**
 * Hace sitio cuando el mapa toca el techo: primero lo vencido y, si no basta,
 * las ventanas MAS ANTIGUAS. Rechazar la nueva seria dejar de contar justo lo
 * que esta atacando ahora; lo que se pierde son ventanas a punto de vencer.
 */
function hacerSitio(ahora: number) {
  purgarVencidos(ahora)
  let porDesalojar = intentos.size >= MAXIMO_INTENTOS_EN_MEMORIA ? DESALOJO_POR_TANDA : 0
  for (const clave of intentos.keys()) {
    if (porDesalojar-- <= 0) return
    intentos.delete(clave)
  }
}

function ventanaVigente(clave: string, ahora: number): Ventana | undefined {
  const ventana = intentos.get(clave)
  return ventana && ventana.expiraEn > ahora ? ventana : undefined
}

/** Suma uno a la clave y devuelve su ventana. */
function sumar(clave: string, ventanaMs: number, ahora: number): Ventana {
  if (ahora - ultimaPurga > 60_000) purgarVencidos(ahora)

  const vigente = ventanaVigente(clave, ahora)
  if (vigente) {
    vigente.conteo += 1
    return vigente
  }
  if (intentos.size >= MAXIMO_INTENTOS_EN_MEMORIA) hacerSitio(ahora)
  const nueva = { conteo: 1, expiraEn: ahora + ventanaMs }
  intentos.set(clave, nueva)
  return nueva
}

/** Cuenta un uso y dice si sigue dentro del limite. */
export function limitarIntentos(accion: string, identificador: string, limite: number, ventanaMs: number) {
  const ahora = Date.now()
  const ventana = sumar(claveDe(accion, identificador), ventanaMs, ahora)
  return {
    permitido: ventana.conteo <= limite,
    reintentarEnSegundos: ventana.conteo === 1 ? 0 : Math.max(1, Math.ceil((ventana.expiraEn - ahora) / 1000)),
  }
}

/** Mira, sin contar, si la clave ya llego a `limite` fallos. */
export function superaFallos(accion: string, identificador: string, limite: number): boolean {
  const vigente = ventanaVigente(claveDe(accion, identificador), Date.now())
  return Boolean(vigente && vigente.conteo >= limite)
}

/** Cuantos fallos lleva la clave en su ventana vigente. NO cuenta nada. */
export function fallosVigentes(accion: string, identificador: string): number {
  return ventanaVigente(claveDe(accion, identificador), Date.now())?.conteo ?? 0
}

/** Cuenta un fallo. */
export function apuntarFallo(accion: string, identificador: string, ventanaMs: number) {
  sumar(claveDe(accion, identificador), ventanaMs, Date.now())
}

/**
 * Borra la cuenta de una clave. Se llama cuando la accion SALE BIEN: el limite
 * cuenta fallos, no usos, o un mostrador compartido se bloquea solo.
 */
export function limpiarIntentos(accion: string, identificador: string) {
  intentos.delete(claveDe(accion, identificador))
}

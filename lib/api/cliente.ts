import type { Turno } from '@/lib/turnos/types'
import { diaColombia } from '@/lib/turnos/tiempo'

/**
 * Error de la API que conserva el codigo HTTP (para distinguir un 401) y el
 * cuerpo de la respuesta (el 409 de un turno trae ahi el estado real).
 */
export class ErrorApi extends Error {
  readonly status: number
  readonly cuerpo: unknown

  constructor(mensaje: string, status: number, cuerpo: unknown = null) {
    super(mensaje)
    this.name = 'ErrorApi'
    this.status = status
    this.cuerpo = cuerpo
  }
}

/**
 * La propia pantalla cancelo la peticion (salio otra mas nueva, o se cerro).
 *
 * NO ES UN ERROR y no se le muestra a nadie: es "la ultima peticion gana"
 * haciendo su trabajo. Tiene su propio tipo para que ninguna pantalla lo
 * confunda con un fallo de red y pinte un aviso rojo por nada.
 */
export class PeticionCancelada extends Error {
  constructor() {
    super('La peticion se cancelo porque salio otra mas nueva.')
    this.name = 'PeticionCancelada'
  }
}

export function esCancelacion(error: unknown): boolean {
  return error instanceof PeticionCancelada
}

/** Lo que ve el funcionario cuando no hay red. Nada de "Failed to fetch". */
export const MENSAJE_SIN_CONEXION = 'Sin conexion con el servidor. Revisa el internet e intenta de nuevo.'
const MENSAJE_SIN_RESPUESTA = 'El servidor tardo demasiado en responder. Revisa la conexion e intenta de nuevo.'

/**
 * Traduce lo que lanza `fetch` a algo que se pueda leer en un mostrador.
 *
 * `fetch` avisa de la falta de red con un `TypeError` ("Failed to fetch",
 * en ingles y sin decir que hacer). La cancelacion puede venir de quien llama
 * (se ignora) o del limite de tiempo (se dice que tardo demasiado).
 */
function traducirFalloDeRed(error: unknown, cancelacion: { porQuienLlama: boolean; porTiempo: boolean }): Error {
  if (cancelacion.porQuienLlama) return new PeticionCancelada()
  if (cancelacion.porTiempo) return new Error(MENSAJE_SIN_RESPUESTA)
  if (error instanceof TypeError) return new Error(MENSAJE_SIN_CONEXION)
  return error instanceof Error ? error : new Error(MENSAJE_SIN_CONEXION)
}

/**
 * Cuanto se espera una respuesta antes de darla por perdida.
 *
 * Sin limite, con la red lenta una peticion se quedaba colgada minutos: los
 * botones seguian bloqueados ("cargando") y la pantalla no se ponia al dia.
 * Si la peticion trae su propia `signal`, manda esa.
 */
export const MS_LIMITE_PETICION = 20000

export type OpcionesPedir = RequestInit & {
  /**
   * Desactiva el envio al login cuando la respuesta es 401.
   *
   * Lo usa la pantalla del doctor, que no entra con sesion sino con un enlace
   * temporal: ahi un 401 significa "el enlace vencio", y mandarlo a un login
   * donde no tiene cuenta no le sirve de nada. Esa pantalla ya muestra su
   * propio aviso.
   */
  sinRedirigirAlLogin?: boolean
  /**
   * Limite de tiempo propio, para lo que tarda de verdad (subir y procesar el
   * reporte de citas). Por defecto `MS_LIMITE_PETICION`.
   */
  msLimite?: number
}

/**
 * Cliente HTTP minimo para las pantallas internas.
 *
 * Lanza `ErrorApi` con el mensaje que devuelve la API, para que cada pantalla
 * lo muestre tal cual en su aviso en lugar de un texto generico.
 *
 * SESION CAIDA: un 401 manda al login. Antes no, y el resultado era peligroso
 * en un mostrador: la sesion dura una jornada, asi que vencia estando el
 * funcionario trabajando (o caia en el acto si el administrador desactivaba la
 * cuenta). A partir de ahi la pantalla seguia mostrando los datos de antes
 * —pacientes, citas, la fila— y cada accion respondia "No autorizado" en un
 * aviso pequeño. Nadie lee eso como "volve a entrar": se lee como un error
 * raro, se reintenta, y entretanto se cree haber registrado llegadas que no se
 * registraron.
 */
export async function pedir<T>(url: string, opciones?: OpcionesPedir): Promise<T> {
  const { sinRedirigirAlLogin, msLimite = MS_LIMITE_PETICION, ...init } = opciones ?? {}
  const { res, cuerpo } = await enviar(url, init, msLimite)

  if (!res.ok) {
    irAlLoginSiCaducoLaSesion(res.status, sinRedirigirAlLogin)
    throw new ErrorApi(mensajeDeLaApi(cuerpo) ?? mensajePorEstado(res.status), res.status, cuerpo)
  }
  // Un 200 que no es JSON no es una respuesta buena: es un portal cautivo o
  // una pagina intermedia. Antes se devolvia `{}` como si lo fuera, y la
  // pantalla se caia al leer `modulos` o `pendientes` de un objeto vacio.
  if (cuerpo === SIN_JSON) throw new Error(MENSAJE_SIN_CONEXION)
  return cuerpo as T
}

/** Marca de "la respuesta no traia JSON legible". */
const SIN_JSON = Symbol('sin-json')

/**
 * Hace la peticion y lee el cuerpo, con limite de tiempo y la cancelacion de
 * quien llama. El limite corre SIEMPRE, tambien cuando quien llama trae su
 * propia `signal`: antes, con una `signal` propia, la peticion podia quedarse
 * colgada sin limite. Leer el cuerpo entra en el limite: con la red lenta, es
 * ahi donde se queda colgada.
 */
async function enviar(url: string, init: RequestInit, msLimite: number) {
  const limite = new AbortController()
  const soltarExterna = reenviarCancelacion(init.signal, limite)
  const temporizador = setTimeout(() => limite.abort(), msLimite)
  try {
    const res = await fetch(url, { ...init, signal: limite.signal, headers: cabecerasDe(init) })
    const cuerpo: unknown = await res.json().catch(() => SIN_JSON)
    return { res, cuerpo }
  } catch (error) {
    const porQuienLlama = Boolean(init.signal?.aborted)
    throw traducirFalloDeRed(error, { porQuienLlama, porTiempo: limite.signal.aborted && !porQuienLlama })
  } finally {
    clearTimeout(temporizador)
    soltarExterna()
  }
}

/**
 * Las cabeceras: JSON por defecto, salvo con un formulario (subida de un
 * archivo), donde el navegador tiene que poner la suya con el separador. Con la
 * cabecera equivocada el servidor no encuentra el archivo.
 */
function cabecerasDe(init: RequestInit): HeadersInit | undefined {
  if (init.body instanceof FormData) return init.headers
  return { 'Content-Type': 'application/json', ...init.headers }
}

/**
 * Sesion caida: manda al login y vuelve aqui despues de entrar.
 *
 * Recarga completa a proposito, no `router.push`: con la sesion vencida hay que
 * TIRAR el estado que quedo en memoria —la fila, las citas, el paciente a medio
 * registrar—, no navegar por encima de el. La URL va absoluta contra el origen
 * actual porque Next avisa de los destinos relativos.
 */
function irAlLoginSiCaducoLaSesion(status: number, sinRedirigirAlLogin?: boolean) {
  if (status !== 401 || sinRedirigirAlLogin || typeof window === 'undefined') return
  const volverA = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = new URL(`/auth/login?sesion=expirada&volverA=${volverA}`, window.location.origin).toString()
}

/** El `error` que escribio la API, si la respuesta fue JSON y lo trae. */
function mensajeDeLaApi(cuerpo: unknown): string | null {
  if (typeof cuerpo !== 'object' || cuerpo === null || !('error' in cuerpo)) return null
  return typeof cuerpo.error === 'string' && cuerpo.error ? cuerpo.error : null
}

/**
 * Lo que se dice cuando la respuesta no trae mensaje propio.
 *
 * Pasa cuando contesta nginx y no la aplicacion (limite de peticiones,
 * servidor reiniciandose, subida demasiado grande): el cuerpo es HTML y antes
 * el funcionario leia "Ocurrio un error inesperado", que no dice que hacer.
 */
const MENSAJE_POR_ESTADO: Record<number, string> = {
  413: 'El archivo es demasiado grande para subirlo. Divide el reporte e intentalo de nuevo.',
  429: 'Se hicieron demasiadas peticiones seguidas. Espera unos segundos y vuelve a intentarlo.',
  502: 'El servidor no esta disponible en este momento (puede estar reiniciandose). Vuelve a intentarlo en unos segundos.',
  503: 'El servidor no esta disponible en este momento (esta muy ocupado). Vuelve a intentarlo en unos segundos.',
  504: MENSAJE_SIN_RESPUESTA,
}

function mensajePorEstado(status: number): string {
  return MENSAJE_POR_ESTADO[status] ?? 'Ocurrio un error inesperado. Vuelve a intentarlo; si sigue pasando, avisa a sistemas.'
}

/** Si la `signal` de quien llama se cancela, cancela tambien la propia. */
function reenviarCancelacion(externa: AbortSignal | null | undefined, propia: AbortController): () => void {
  if (!externa) return () => {}
  if (externa.aborted) propia.abort()
  const cancelar = () => propia.abort()
  externa.addEventListener('abort', cancelar)
  return () => externa.removeEventListener('abort', cancelar)
}

function pareceTurno(valor: unknown): valor is Turno {
  return typeof valor === 'object' && valor !== null && 'id' in valor && 'codigo' in valor
}

/**
 * El turno abierto real que trae un 409 de "llamar al siguiente", o null si el
 * error no es ese conflicto (o si el real es "ninguno").
 *
 * Es lo que deja a la pantalla ponerse al dia en el acto cuando el funcionario
 * pulso sobre un estado viejo (se perdio la respuesta de un llamado anterior).
 */
export function turnoRealDelConflicto(error: unknown): Turno | null {
  if (!(error instanceof ErrorApi) || error.status !== 409) return null
  const { cuerpo } = error
  if (typeof cuerpo !== 'object' || cuerpo === null || !('turnoActual' in cuerpo)) return null
  return pareceTurno(cuerpo.turnoActual) ? cuerpo.turnoActual : null
}

/**
 * Si el servidor RECHAZO el acceso (401/403), en vez de haber fallado la red.
 *
 * La diferencia importa donde el acceso puede vencer de verdad: un microcorte
 * de wifi no es un enlace vencido, y tratarlo como tal deja al doctor mirando
 * un cartel de "enlace no valido" con el enlace bueno en la mano.
 */
export function esRechazoDeAcceso(error: unknown): boolean {
  return error instanceof ErrorApi && (error.status === 401 || error.status === 403)
}

export function mensajeDeError(error: unknown) {
  if (esCancelacion(error)) return undefined
  return error instanceof Error ? error.message : undefined
}

/** Fecha de hoy en Colombia, en formato AAAA-MM-DD (para inputs `type="date"`). */
export function hoyEnColombia() {
  return diaColombia(new Date())
}

export function horaCorta(iso?: string | null) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

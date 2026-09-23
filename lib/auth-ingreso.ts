/**
 * Inicio de sesion desde el navegador: enviar usuario y contrasena a Auth.js y
 * decir la VERDAD sobre lo que paso.
 *
 * POR QUE NO SE USA `signIn` DE `next-auth/react`. Con internet lento o nginx
 * limitando, esa funcion fallaba de tres maneras que el funcionario no podia
 * entender:
 *   - un 429 o un 502 con cuerpo HTML hacia reventar su `res.json()`, la
 *     promesa se rechazaba y el boton se quedaba en "Validando acceso..." para
 *     siempre;
 *   - si fallaba la consulta previa de proveedores, SACABA al funcionario de la
 *     pagina hacia `/api/auth/error`, aunque se le pidiera no redirigir;
 *   - si fallaba el CSRF, mandaba un token vacio y el rechazo llegaba como
 *     "usuario o contrasena incorrectos".
 *
 * Aqui se habla con los mismos dos endpoints que usa la libreria (el CSRF y el
 * callback de credenciales, con `X-Auth-Return-Redirect` para recibir JSON en
 * vez de una redireccion) y cada fallo se clasifica. Nunca lanza.
 *
 * `pedir` se inyecta para poder probarlo sin red.
 */
import type { LoginInput } from '@/lib/validators/auth'

export type ResultadoDeIngreso =
  | 'ingreso'
  | 'credenciales_invalidas'
  | 'cuenta_en_espera'
  | 'origen_en_espera'
  | 'fuente_no_disponible'
  | 'servidor_ocupado'
  | 'sin_conexion'
  | 'fallo_inesperado'

export type FalloDeIngreso = Exclude<ResultadoDeIngreso, 'ingreso'>

type Pedir = (url: string, init?: RequestInit) => Promise<Response>

const RUTA_CSRF = '/api/auth/csrf'
const RUTA_CREDENCIALES = '/api/auth/callback/credentials'

/**
 * Cuanto se espera, EN TOTAL, antes de rendirse.
 *
 * Sin tope, con el internet del hospital degradado la peticion podia quedarse
 * colgada indefinidamente y el boton con ella. Veinte segundos aguantan una
 * conexion lenta de verdad sin dejar al funcionario mirando un spinner eterno.
 * Es una sola espera para las dos peticiones (CSRF y envio): con una por
 * peticion, lo peor eran cuarenta segundos.
 */
const MS_ESPERA_MAXIMA = 20_000

/** Texto para cada fallo. Solo uno culpa a la contrasena, y a proposito. */
export const MENSAJES_DE_INGRESO: Record<FalloDeIngreso, string> = {
  credenciales_invalidas: 'Usuario o contrasena incorrectos.',
  cuenta_en_espera:
    'Por seguridad, esta cuenta quedo en espera tras varios intentos fallidos. Espera unos minutos (como maximo 15) y vuelve a intentarlo, o pide a sistemas que la revise.',
  origen_en_espera:
    'Hay demasiados intentos de entrada desde esta red. Espera unos minutos y vuelve a intentarlo; si sigue pasando, avisa a sistemas.',
  fuente_no_disponible:
    'No se pudo verificar tu acceso: el sistema no esta conectado a la base de datos. Avisa a soporte; no es tu contrasena.',
  servidor_ocupado:
    'El servidor esta ocupado o reiniciandose y no pudo atenderte. Espera unos segundos y vuelve a intentarlo; no es tu contrasena.',
  sin_conexion:
    'No hay conexion con el servidor: el internet esta caido o muy lento. Revisa la conexion y vuelve a intentarlo; no es tu contrasena.',
  fallo_inesperado:
    'No se pudo completar la entrada por un problema del sistema. Vuelve a intentarlo; si sigue pasando, avisa a sistemas.',
}

/** Respuesta que no se puede leer: la dio nginx, un portal cautivo o un servidor caido. */
class RespuestaIlegible extends Error {}

const pedirAlServidor: Pedir = (url, init) => fetch(url, init)

/** El JSON de la respuesta, o `RespuestaIlegible` si no lo hay o el estado es de error. */
async function leerJson(respuesta: Response): Promise<unknown> {
  if (!respuesta.ok) throw new RespuestaIlegible(`estado ${respuesta.status}`)
  try {
    return await respuesta.json()
  } catch {
    throw new RespuestaIlegible('cuerpo que no es JSON')
  }
}

function campoDeTexto(cuerpo: unknown, campo: string): string {
  if (typeof cuerpo !== 'object' || cuerpo === null) return ''
  const valor: unknown = Reflect.get(cuerpo, campo)
  return typeof valor === 'string' ? valor : ''
}

async function pedirTokenCsrf(pedir: Pedir, signal: AbortSignal): Promise<string> {
  const token = campoDeTexto(await leerJson(await pedir(RUTA_CSRF, { signal })), 'csrfToken')
  if (!token) throw new RespuestaIlegible('sin token CSRF')
  return token
}

interface Envio {
  credenciales: LoginInput
  csrfToken: string
  signal: AbortSignal
}

async function enviarCredenciales(pedir: Pedir, envio: Envio) {
  const { credenciales, csrfToken, signal } = envio
  const respuesta = await pedir(RUTA_CREDENCIALES, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' },
    body: new URLSearchParams({ ...credenciales, csrfToken, callbackUrl: '/auth/redirect' }),
  })
  return campoDeTexto(await leerJson(respuesta), 'url')
}

/** Los `code` de Auth.js que tienen desenlace propio. Una linea por codigo nuevo. */
const DESENLACE_POR_CODIGO = new Map<string, ResultadoDeIngreso>([
  ['fuente_no_disponible', 'fuente_no_disponible'],
  ['cuenta_en_espera', 'cuenta_en_espera'],
  ['origen_en_espera', 'origen_en_espera'],
])

/**
 * Lee el desenlace en la URL que devuelve Auth.js.
 *
 * `code` lo pone `lib/auth.ts` cuando lo que fallo no fueron las credenciales
 * sino la fuente de usuarios. Cualquier otro error de Auth.js (CSRF que no
 * cuadra, configuracion) es un fallo del sistema, no del funcionario.
 */
export function resultadoDeLaUrl(url: string): ResultadoDeIngreso {
  if (!url) return 'fallo_inesperado'
  const parametros = new URL(url, 'http://local').searchParams
  const error = parametros.get('error')
  if (!error) return 'ingreso'
  if (error !== 'CredentialsSignin') return 'fallo_inesperado'
  return DESENLACE_POR_CODIGO.get(parametros.get('code') ?? '') ?? 'credenciales_invalidas'
}

/**
 * Traduce una excepcion al fallo que vive el funcionario.
 *
 * `TypeError` es como `fetch` avisa de que no hubo red; `TimeoutError` y
 * `AbortError`, de que se vencio la espera.
 */
function falloDe(error: unknown): FalloDeIngreso {
  if (error instanceof RespuestaIlegible) return 'servidor_ocupado'
  if (error instanceof TypeError) return 'sin_conexion'
  if (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name)) return 'sin_conexion'
  return 'fallo_inesperado'
}

/** Intenta entrar. Nunca lanza: todo desenlace vuelve como resultado. */
export async function ingresarConCredenciales(
  credenciales: LoginInput,
  pedir: Pedir = pedirAlServidor,
): Promise<ResultadoDeIngreso> {
  const signal = AbortSignal.timeout(MS_ESPERA_MAXIMA)
  try {
    const csrfToken = await pedirTokenCsrf(pedir, signal)
    return resultadoDeLaUrl(await enviarCredenciales(pedir, { credenciales, csrfToken, signal }))
  } catch (error) {
    return falloDe(error)
  }
}

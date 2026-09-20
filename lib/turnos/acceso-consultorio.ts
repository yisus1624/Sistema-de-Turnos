/**
 * Autenticacion por token para las rutas del consultorio del profesional.
 *
 * El doctor entra por un enlace temporal, sin usuario ni contrasena (ver
 * `lib/turnos/in-memory-repository.ts`, `crearAccesoProfesional`). Estas
 * rutas NO usan `requireRol`: la sesion aqui es el token.
 *
 * EL TOKEN YA NO VIAJA EN LA RUTA, Y ESO NO ES COSMETICA.
 *
 * Estaba en el path de cada llamada (`/api/consultorio/<token>/...`). Nginx
 * escribe `$request` entero en su `access.log` por defecto, asi que cada
 * "siguiente", cada "repetir" y cada refresco de la fila dejaba el token EN
 * CLARO en un archivo del servidor —decenas de lineas por doctor y por
 * jornada—. Quien pudiera leer esos logs, o una copia de seguridad de ellos,
 * se llevaba una llave que abre la agenda con nombres y documentos de
 * pacientes sin pedir contrasena, valida hasta que venciera. De paso dejaba sin
 * sentido que la copia del token se guarde cifrada en la base: la misma llave
 * estaba en texto plano en otro archivo del mismo servidor.
 *
 * Ahora el token llega por una de estas dos vias, ninguna de las cuales queda
 * en el registro de peticiones:
 *
 *   1. La COOKIE `turnos_consultorio`, que pone el proxy de entrada la primera vez
 *      que el doctor abre su enlace y que el navegador manda sola a partir de
 *      ahi. Es `HttpOnly`, asi que el JavaScript de la pagina ni siquiera
 *      puede leerla, y `SameSite=Strict`, asi que no viaja desde otro sitio.
 *   2. La cabecera `x-consultorio-token`, para el panel de simulacion de
 *      carga, que hace de varios doctores a la vez desde una sola pestaña y
 *      por tanto no puede usar una unica cookie.
 *
 * El enlace sigue conteniendo el token —es lo que se le manda al doctor— asi
 * que su PRIMERA visita si deja una linea. Una por jornada en vez de cientos, y
 * `proxy.ts` lo saca de la barra de direcciones en el acto.
 *
 * SE CUENTAN FALLOS, NO USOS. El limite estaba puesto sobre el token y sin
 * limpiarlo al entrar bien, asi que no medía "cuantas veces han fallado" sino
 * "cuantas peticiones ha hecho este enlace": pasadas 30 en cinco minutos el
 * enlace dejaba de responder a media jornada. La pantalla del consultorio se
 * recarga con cada evento del hospital, de modo que ese tope se alcanza solo en
 * hora pico, y al medico le salia "el enlace no es valido" con el enlace bueno
 * en la mano.
 *
 * Y contra la fuerza bruta, un contador POR TOKEN no sirve de nada: quien
 * intenta adivinar usa un token distinto en cada intento y estrena contador. Lo
 * que si acota una avalancha es el ORIGEN, y solo cuando la IP es de fiar, es
 * decir con un proxy declarado delante (ver `contextoPeticion`). Sin el, la IP
 * la escribe el propio cliente: bloquear por ella no protegeria de nada y
 * podria dejar fuera a todo el hospital, que sale por una sola salida.
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from './repositorio'
import type { Profesional } from './types'
import {
  contextoPeticion,
  limitarIntentos,
  limpiarIntentos,
  registrarEvento,
} from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { apiError } from '@/lib/permissions/session'

/**
 * Nombre de la cookie de sesion del consultorio. Lo comparten `proxy.ts`
 * (que la pone) y estas rutas (que la leen); si se cambia en un sitio y no en
 * el otro, el doctor entra y la pantalla se queda en "enlace no valido".
 */
export const COOKIE_CONSULTORIO = 'turnos_consultorio'

/** Cabecera alternativa, solo para el panel de simulacion de carga. */
export const CABECERA_CONSULTORIO = 'x-consultorio-token'

/**
 * El token de esta peticion, o cadena vacia si no trae ninguno.
 *
 * Se lee de la cabecera `Cookie` de la propia peticion y no de `cookies()` de
 * Next a proposito: asi la funcion depende solo del `Request` estandar, que es
 * lo que la hace verificable en las pruebas sin montar el entorno de Next.
 */
export function tokenDeLaPeticion(request: Request): string {
  const enCabecera = request.headers.get(CABECERA_CONSULTORIO)
  if (enCabecera) return enCabecera.trim()

  const cookies = request.headers.get('cookie')
  if (!cookies) return ''

  for (const parte of cookies.split(';')) {
    const separador = parte.indexOf('=')
    if (separador === -1) continue
    if (parte.slice(0, separador).trim() !== COOKIE_CONSULTORIO) continue
    return decodeURIComponent(parte.slice(separador + 1).trim())
  }
  return ''
}

export class AccesoInvalidoError extends Error {
  readonly status = 401

  constructor() {
    super('El enlace no es valido o ya vencio. Pide un enlace nuevo a la oficina de sistemas.')
    this.name = 'AccesoInvalidoError'
  }
}

/** Ventana de los dos limites. */
const MS_VENTANA = 5 * 60 * 1000

/**
 * Fallos seguidos del MISMO enlace antes de dejar de atenderlo. Ya no cuenta
 * usos, solo fallos, asi que puede ser holgado: un enlace bueno nunca llega.
 */
const INTENTOS_POR_TOKEN = 30

/**
 * Fallos seguidos desde el MISMO origen. Mas alto que el del token porque
 * detras de una IP puede haber todo el hospital cuando hay proxy: tiene que
 * cortar la avalancha de tokens al azar sin estorbar a un consultorio que
 * reabre su enlace vencido un par de veces.
 */
const INTENTOS_POR_IP = 50

/** Deja el rechazo apuntado y devuelve el error, para lanzarlo en el sitio. */
async function rechazoRegistrado(ip: string | null, motivo: string) {
  await registrarEvento({ tipo: EVENTOS.ACCESO_PROFESIONAL, exito: false, ip, detalle: { motivo } })
  return new AccesoInvalidoError()
}

/**
 * Valida el token de la ruta y devuelve el profesional. Lanza
 * `AccesoInvalidoError` (401) si no sirve, para que `apiError` lo traduzca
 * sin exponer detalles del motivo (no existe / vencio / fue revocado se ven
 * igual desde afuera, a proposito).
 */
export async function requireProfesionalPorToken(token: string): Promise<Profesional> {
  const { ip } = await contextoPeticion()

  // Sin token no se gasta el cupo del limitador: la clave seria la cadena
  // vacia, un mismo cubo compartido por todas las peticiones sin cookie, y
  // bastaria un bucle sin token para agotarlo y dejar fuera al doctor cuya
  // cookie no llego. Se rechaza y se apunta, que es lo que hace falta.
  if (!token) throw await rechazoRegistrado(ip, 'sin_token')

  if (ip && !limitarIntentos('acceso_consultorio_ip', ip, INTENTOS_POR_IP, MS_VENTANA).permitido) {
    throw await rechazoRegistrado(ip, 'demasiados_intentos_ip')
  }

  // Un mismo enlace fallando una y otra vez si tiene tope: es el enlace vencido
  // que quedo abierto en un televisor o en la pestaña de alguien, recargando.
  if (!limitarIntentos('token_consultorio', token, INTENTOS_POR_TOKEN, MS_VENTANA).permitido) {
    throw await rechazoRegistrado(ip, 'demasiados_intentos')
  }

  const profesional = await turnoRepository.validarAccesoProfesional(token)
  if (!profesional) throw await rechazoRegistrado(ip, 'token_invalido')

  // Entro bien: se le borra la cuenta al enlace y al origen. Sin esto el limite
  // cuenta peticiones en vez de fallos y el doctor se bloquea a si mismo.
  limpiarIntentos('token_consultorio', token)
  if (ip) limpiarIntentos('acceso_consultorio_ip', ip)

  if (debeRegistrarAcceso(profesional.id)) {
    await registrarEvento({
      tipo: EVENTOS.ACCESO_PROFESIONAL,
      exito: true,
      ip,
      identificador: profesional.id,
      detalle: { profesional: profesional.nombre },
    })
  }

  return profesional
}

/**
 * El profesional de esta peticion, a partir de su cookie o cabecera.
 *
 * Es lo que llaman las rutas del consultorio. Sin token no se distingue de un
 * token malo: las dos cosas son `AccesoInvalidoError` y el doctor lee el mismo
 * mensaje, que es lo correcto —decirle "no mandaste token" frente a "tu token
 * no sirve" solo ayuda a quien esta probando a ciegas—.
 */
export async function requireProfesionalDelConsultorio(request: Request): Promise<Profesional> {
  return requireProfesionalPorToken(tokenDeLaPeticion(request))
}

/**
 * Cuanto se deja pasar entre dos apuntes de "este doctor esta usando su
 * enlace". Diez minutos: sigue mostrando quien estuvo conectado y cuando, sin
 * escribir una linea por peticion.
 */
const MS_ENTRE_APUNTES_DE_ACCESO = 10 * 60 * 1000

declare global {
  var __turnosUltimoAccesoRegistrado: Map<string, number> | undefined
}

const ultimoApunte: Map<string, number> =
  globalThis.__turnosUltimoAccesoRegistrado ?? new Map()
globalThis.__turnosUltimoAccesoRegistrado = ultimoApunte

/**
 * Si toca dejar constancia de este acceso.
 *
 * La pantalla del doctor se refresca sola y cada refresco pasa por aqui: se
 * escribia un evento de exito por peticion, contra un registro que solo guarda
 * los ultimos 500. Con varios consultorios abiertos, ese goteo barria en
 * minutos lo que de verdad hay que poder revisar despues (los intentos de
 * entrada fallidos). El acceso se sigue registrando, pero espaciado.
 *
 * Los fallos NUNCA se agrupan: esos se apuntan siempre.
 */
function debeRegistrarAcceso(profesionalId: string): boolean {
  const ahora = Date.now()
  const anterior = ultimoApunte.get(profesionalId)
  if (anterior !== undefined && ahora - anterior < MS_ENTRE_APUNTES_DE_ACCESO) return false

  ultimoApunte.set(profesionalId, ahora)
  return true
}

/**
 * El error de las rutas del consultorio.
 *
 * DELEGA EN `apiError`, no lo reimplementa. Tenia su propia copia de la misma
 * logica, y cuando `apiError` dejo de devolver hacia fuera el mensaje de los
 * fallos inesperados, esta copia se quedo como estaba: las cinco rutas del
 * consultorio seguian pintandole al medico —delante del paciente— el volcado
 * crudo de Prisma, con nombres de tabla, de columna y rutas del servidor. Y
 * justo en la unica puerta del sistema que no pasa por usuario y contraseña.
 *
 * Lo unico propio es el 401 del enlace invalido, que es el caso que esta
 * funcion existe para tratar: un mensaje escrito para el doctor, sin distinguir
 * si el enlace no existe, vencio o lo revocaron.
 */
export function errorConsultorio(error: unknown) {
  if (error instanceof AccesoInvalidoError) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }
  return apiError(error)
}

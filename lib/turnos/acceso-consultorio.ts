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
 *
 * EL FRENO POR ORIGEN NO TUMBA A QUIEN YA ESTABA TRABAJANDO. Con el hospital
 * saliendo por una sola IP, un equipo del wifi de pacientes probando tokens
 * frenaba esa IP y el freno rechazaba tambien los enlaces BUENOS, con el mismo
 * 401 de "enlace no valido": todos los consultorios en rojo a la vez, y
 * regenerar enlaces no servia mientras durara. Ahora el freno solo corta lo que
 * este servidor no ha visto entrar bien (ver `entroBienHacePoco`), que es justo
 * lo que prueba quien adivina, y responde 429, que la pantalla reintenta sola.
 */
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { turnoRepository } from './repositorio'
import { MINUTOS_ACCESO_MAXIMO } from './repository'
import type { Profesional } from './types'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { apuntarFallo, limpiarIntentos, superaFallos } from '@/lib/seguridad/limitador'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { apiError } from '@/lib/permissions/session'
import { cuerpoJson, profesionalVistoSchema } from '@/lib/validators/turnos'

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
    return decodificarToken(parte.slice(separador + 1).trim())
  }
  return ''
}

/** Un `%` roto es un token invalido (''), no un error: con el 500 la pantalla reintentaba sin fin. */
function decodificarToken(crudo: string): string {
  try {
    return decodeURIComponent(crudo)
  } catch {
    return ''
  }
}

export class AccesoInvalidoError extends Error {
  readonly status = 401

  constructor() {
    super('El enlace no es valido o ya vencio. Pide un enlace nuevo a la oficina de sistemas.')
    this.name = 'AccesoInvalidoError'
  }
}

/**
 * El origen de la peticion esta frenado por demasiados fallos (429).
 *
 * NO ES "ENLACE NO VALIDO", y el codigo importa: con un 401 la pantalla del
 * doctor daba su enlace por vencido y le pedia uno nuevo; un 429 es "espera y
 * vuelve", que es lo que de verdad pasa, porque el freno se levanta solo.
 */
export class FrenoDeAccesoError extends Error {
  readonly status = 429

  constructor() {
    super('Hay demasiados intentos de entrada desde esta red. Espera unos minutos: la pantalla vuelve a intentarlo sola.')
    this.name = 'FrenoDeAccesoError'
  }
}

/**
 * La forma de un token de consultorio: 32 bytes al azar en base64url, que son
 * 43 caracteres (ver `crearAccesoProfesional`).
 */
const FORMATO_DEL_TOKEN = /^[A-Za-z0-9_-]{43}$/

/** Ventana de los dos limites. */
const MS_VENTANA = 5 * 60 * 1000

/**
 * Fallos seguidos del MISMO enlace antes de dejar de atenderlo. Ya no cuenta
 * usos, solo fallos, asi que puede ser holgado: un enlace bueno nunca llega.
 */
const INTENTOS_POR_TOKEN = 30

/**
 * Intentos fallidos desde el MISMO origen (IP) antes de frenarlo.
 *
 * AMPLIO A PROPOSITO. Todo el hospital sale por una sola IP, que cambia sin
 * aviso y no se puede eximir: varias pestañas con enlaces vencidos recargando
 * en distintos consultorios no pueden agotar el cupo de todos y dejar fuera al
 * doctor con su enlace bueno. Quinientos en cinco minutos no los alcanza una
 * oficina; si los alcanza quien prueba tokens al azar desde un mismo origen.
 * El freno fino es el del propio enlace (`INTENTOS_POR_TOKEN`).
 */
const INTENTOS_POR_IP = 500

/** Deja el rechazo apuntado y devuelve el error, para lanzarlo en el sitio. */
async function rechazoRegistrado(ip: string | null, motivo: string, error: Error = new AccesoInvalidoError()) {
  await registrarEvento({ tipo: EVENTOS.ACCESO_PROFESIONAL, exito: false, ip, detalle: { motivo } })
  return error
}

/**
 * Valida el token de la ruta y devuelve el profesional. Lanza
 * `AccesoInvalidoError` (401) si no sirve, para que `apiError` lo traduzca
 * sin exponer detalles del motivo (no existe / vencio / fue revocado se ven
 * igual desde afuera, a proposito), o `FrenoDeAccesoError` (429) si su origen
 * esta frenado y el enlace no es de los que ya entraron bien.
 */
export async function requireProfesionalPorToken(token: string): Promise<Profesional> {
  const { ip } = await contextoPeticion()
  await exigirQuePuedaIntentarlo(token, ip)

  const profesional = await turnoRepository.validarAccesoProfesional(token)
  if (!profesional) throw await rechazoPorEnlaceInvalido(token, ip)

  await registrarEntrada(profesional, token, ip)
  return profesional
}

/** Lo que se rechaza SIN ir a la base: sin token, mal formado o frenado. */
async function exigirQuePuedaIntentarlo(token: string, ip: string | null) {
  // Sin token no se gasta el cupo del limitador: la clave seria la cadena
  // vacia, un mismo cubo compartido por todas las peticiones sin cookie, y
  // bastaria un bucle sin token para agotarlo y dejar fuera al doctor cuya
  // cookie no llego. Se rechaza y se apunta, que es lo que hace falta.
  if (!token) throw await rechazoRegistrado(ip, 'sin_token')

  // El formato real antes que nada: el token llega de una cookie o de una
  // cabecera y lo escribe quien quiera. Uno que no tiene la forma de los que
  // genera el sistema no puede ser bueno, y asi no llega ni al limitador ni a
  // la base, por largo que sea.
  if (!FORMATO_DEL_TOKEN.test(token)) throw await rechazoRegistrado(ip, 'token_malformado')

  // Se MIRA sin contar: solo cuentan los fallos. Un doctor usando su enlace
  // bueno no gasta cupo de nadie, y si ya entro bien, el freno de su origen no
  // lo toca: lo que frena es lo que nunca entro.
  if (origenFrenado(ip) && !entroBienHacePoco(token)) {
    throw await rechazoRegistrado(ip, 'demasiados_intentos_ip', new FrenoDeAccesoError())
  }

  // Un mismo enlace fallando una y otra vez si tiene tope: es el enlace vencido
  // que quedo abierto en un televisor o en la pestaña de alguien, recargando.
  if (superaFallos('token_consultorio', token, INTENTOS_POR_TOKEN)) {
    throw await rechazoRegistrado(ip, 'demasiados_intentos')
  }
}

function origenFrenado(ip: string | null): boolean {
  if (!ip) return false
  return superaFallos('acceso_consultorio_ip', ip, INTENTOS_POR_IP)
}

/** Cuenta el fallo (del enlace y de su origen) y devuelve el 401. */
async function rechazoPorEnlaceInvalido(token: string, ip: string | null) {
  if (ip) apuntarFallo('acceso_consultorio_ip', ip, MS_VENTANA)
  apuntarFallo('token_consultorio', token, MS_VENTANA)
  // Revocado, vencido o de un doctor dado de baja: deja de ser de los que
  // pasan el freno, o seguiria llegando a la base mientras el origen este frenado.
  olvidarEnlace(token)
  return rechazoRegistrado(ip, 'token_invalido')
}

async function registrarEntrada(profesional: Profesional, token: string, ip: string | null) {
  // Entro bien: se le borra la cuenta al ENLACE. La del origen no: pueden ser
  // fallos de otros enlaces, y borrarlos con cada acierto dejaba probar tokens
  // al azar sin freno mientras algun doctor trabajara desde la misma IP.
  limpiarIntentos('token_consultorio', token)
  recordarQueEntro(token)

  if (!debeRegistrarAcceso(profesional.id)) return
  await registrarEvento({
    tipo: EVENTOS.ACCESO_PROFESIONAL,
    exito: true,
    ip,
    identificador: profesional.id,
    detalle: { profesional: profesional.nombre },
  })
}

/**
 * Cuanto se recuerda que un enlace entro bien: lo que dura el enlace mas largo
 * que el sistema genera. Recordarlo no le da ningun permiso —cada peticion lo
 * sigue validando contra la base, y uno revocado se rechaza igual—: solo le
 * deja llegar a esa validacion mientras su origen esta frenado.
 */
const MS_RECUERDO_DEL_ENLACE = MINUTOS_ACCESO_MAXIMO * 60 * 1000

declare global {
  var __turnosEnlacesQueEntraron: Map<string, number> | undefined
}

/**
 * Huella de los enlaces que entraron bien, con hasta cuando se recuerdan.
 *
 * Solo entra aqui un token que la base dio por bueno, asi que quien prueba
 * tokens al azar no puede llenarla ni colarse por ella: sus tokens nunca
 * entraron, y con el origen frenado se cortan sin consultar la base, igual que
 * antes. Se guarda la huella (SHA-256) y no el token, que es una llave.
 */
const enlacesQueEntraron: Map<string, number> = globalThis.__turnosEnlacesQueEntraron ?? new Map()
globalThis.__turnosEnlacesQueEntraron = enlacesQueEntraron

function huellaDe(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function entroBienHacePoco(token: string): boolean {
  return (enlacesQueEntraron.get(huellaDe(token)) ?? 0) > Date.now()
}

function recordarQueEntro(token: string) {
  const ahora = Date.now()
  const huella = huellaDe(token)
  if (!enlacesQueEntraron.has(huella)) olvidarLosVencidos(ahora)
  enlacesQueEntraron.set(huella, ahora + MS_RECUERDO_DEL_ENLACE)
}

function olvidarEnlace(token: string) {
  enlacesQueEntraron.delete(huellaDe(token))
}

/** Se barre al llegar un enlace nuevo, que es pocas veces al dia. */
function olvidarLosVencidos(ahora: number) {
  for (const [huella, hasta] of enlacesQueEntraron) {
    if (hasta <= ahora) enlacesQueEntraron.delete(huella)
  }
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
 * La pantalla que actua muestra a OTRO doctor que el de la cookie (409).
 *
 * No es un enlace malo (401): la cookie sirve, pero es de otro. Tampoco lleva
 * `turnoActual`, a diferencia del 409 de un turno: la pantalla no tiene nada
 * que adoptar, tiene que recargar y ver de quien es ahora.
 */
export class OtroProfesionalError extends Error {
  readonly status = 409

  constructor() {
    super(
      'En este navegador se abrio el enlace de otro doctor, asi que esta pantalla ya no corresponde al consultorio abierto. No se hizo ningun cambio. Recarga la pagina (tecla F5).',
    )
    this.name = 'OtroProfesionalError'
  }
}

/**
 * Exige que la pantalla que actua muestre al MISMO profesional de la cookie.
 *
 * Hay UNA cookie de consultorio por navegador. En un PC compartido, abrir el
 * enlace de otro doctor la cambia, y las pestañas que ya estaban abiertas
 * pasaban a actuar como ese otro sin enterarse: "Llamar siguiente" en la
 * pestaña del Dr. A llamaba al paciente del Dr. B y le cerraba al que tenia
 * adentro. La pantalla declara a quien muestra; si no es el de la cookie, no se
 * toca nada.
 *
 * Si no lo declara, pasa: es una pestaña abierta con el codigo de antes, que
 * tiene que seguir funcionando hasta que recargue.
 */
export function exigirMismoProfesional(profesional: Profesional, cuerpo: unknown): void {
  const visto = profesionalVistoSchema.safeParse(cuerpo)
  if (!visto.success || visto.data.profesionalId === undefined) return
  if (visto.data.profesionalId !== profesional.id) throw new OtroProfesionalError()
}

/**
 * El profesional de la cookie, comprobado contra el que muestra la pantalla, y
 * el cuerpo ya leido: una peticion solo se puede leer una vez, y la ruta lo
 * necesita para lo suyo.
 */
export async function requireProfesionalDeLaPantalla(
  request: Request,
): Promise<{ profesional: Profesional; cuerpo: unknown }> {
  const profesional = await requireProfesionalDelConsultorio(request)
  const cuerpo = await cuerpoJson(request)
  exigirMismoProfesional(profesional, cuerpo)
  return { profesional, cuerpo }
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

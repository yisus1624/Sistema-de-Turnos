/**
 * Autenticacion por token para las rutas del consultorio del profesional.
 *
 * El doctor entra por un enlace temporal, sin usuario ni contrasena (ver
 * `lib/turnos/in-memory-repository.ts`, `crearAccesoProfesional`). Estas
 * rutas NO usan `requireRol`: la sesion aqui es el token de la URL.
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

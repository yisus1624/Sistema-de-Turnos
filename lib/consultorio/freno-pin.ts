/**
 * LOS FRENOS DE LA ENTRADA CON PIN.
 *
 * El PIN solo, sin equipo autorizado (decision del hospital: autorizar cada
 * computador quitaba mucho tiempo). Eso deja la puerta abierta a cualquiera
 * que pruebe PIN al azar desde internet, y no se puede frenar por IP con
 * rigor porque TODO el hospital sale por una sola: un medico que se equivoca
 * no puede dejar sin entrar a los demas. Por eso hay dos frenos:
 *
 * - POR NAVEGADOR (el que nota el medico): 4 PIN equivocados en el mismo
 *   navegador lo bloquean 5 minutos. Se reconoce por una cookie propia.
 * - POR CONEXION (el que frena a quien prueba desde fuera): 20 fallos desde la
 *   misma IP la bloquean 15 minutos. En el hospital no se llega: hacen falta
 *   cinco medicos equivocandose cuatro veces cada uno en el mismo rato.
 *
 * Cada fallo queda en el registro de actividad (`ACCESO_POR_PIN`).
 */
import { randomBytes } from 'node:crypto'

/** Cookie que reconoce a este navegador para el freno (no da acceso a nada). */
export const COOKIE_NAVEGADOR = 'turnos_navegador'

/**
 * Cookie que recuerda que en este navegador se entra como medico: la app
 * instalada abre directo el PIN (ver `app/page.tsx`). Tampoco da acceso.
 */
export const COOKIE_ENTRADA = 'turnos_entrada'
export const ENTRADA_DE_MEDICO = 'medico'

export const FALLOS_POR_NAVEGADOR = 4
export const MS_BLOQUEO_NAVEGADOR = 5 * 60 * 1000

export const FALLOS_POR_CONEXION = 20
export const MS_BLOQUEO_CONEXION = 15 * 60 * 1000

const UN_ANIO = 365 * 24 * 60 * 60

export const opcionesDeCookieDeFreno = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: UN_ANIO,
}

/** El identificador de este navegador, o uno nuevo si no traia. */
export function navegadorDeLaPeticion(request: Request): { id: string; nuevo: boolean } {
  const cookies = request.headers.get('cookie') ?? ''
  for (const parte of cookies.split(';')) {
    const corte = parte.indexOf('=')
    if (corte > 0 && parte.slice(0, corte).trim() === COOKIE_NAVEGADOR) {
      const valor = parte.slice(corte + 1).trim()
      if (/^[A-Za-z0-9_-]{16,40}$/.test(valor)) return { id: valor, nuevo: false }
    }
  }
  return { id: randomBytes(12).toString('base64url'), nuevo: true }
}

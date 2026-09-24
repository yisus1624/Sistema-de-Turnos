/**
 * Freno a los intentos de inicio de sesion.
 *
 * SE CUENTAN SOLO FALLOS, POR CAPAS. Todo el hospital sale a internet por una
 * sola IP, que ademas cambia sin aviso, asi que un limite por IP estrecho
 * castiga al hospital entero. Las capas, de la mas fina a la mas gruesa:
 *
 *   1. Cuenta + origen (8 fallos): quien prueba contrasenas contra una cuenta
 *      la deja en espera DESDE ESA IP. Antes la espera iba solo por cuenta, y
 *      un atacante externo dejaba sin poder entrar al dueño que estaba en el
 *      hospital (en la prueba de QA, 33 de 35 cuentas).
 *   2. Cuenta (50 fallos, desde cualquier IP): contra el ataque repartido entre
 *      muchas IPs, que la capa 1 no ve.
 *   3. IP (300 fallos): contra quien prueba cientos de cuentas desde un mismo
 *      origen. Una oficina entera equivocandose no llega.
 *
 * SIN IP DE FIAR (TURNOS_CONFIAR_PROXY=0, el valor por defecto) la capa 1 no
 * bloquea: todas las peticiones comparten el mismo "origen", y 8 contrasenas
 * malas de cualquiera dejaban al dueño sin entrar 15 minutos en todo el
 * hospital. En su lugar hay una ESPERA CRECIENTE con tope
 * (`retardoDeIngresoMs`) que sigue frenando la fuerza bruta sin cerrar la
 * puerta; la capa 2 queda como tope duro ante el ataque masivo.
 *
 * Mirar el freno no cuenta (`frenoDeIngreso`); solo cuenta un fallo real
 * (`apuntarFalloDeIngreso`). Y el acierto de una cuenta borra SUS fallos, nunca
 * los del origen: con una cuenta valida, un atacante borraba el contador de la
 * IP en cada acierto y podia probar miles de contrasenas en 15 minutos.
 */
import { apuntarFallo, fallosVigentes, limpiarIntentos, superaFallos } from './limitador'

export const FALLOS_POR_CUENTA_Y_ORIGEN = 8
export const FALLOS_POR_CUENTA = 50
export const FALLOS_POR_ORIGEN = 300

/** Ventana de los limites. Es tambien lo maximo que dura una espera. */
export const MS_VENTANA_INGRESO = 15 * 60 * 1000

/** Fallos sin espera: los dedazos normales del dueño no se castigan. */
export const FALLOS_SIN_RETARDO = 3
const MS_BASE_RETARDO_INGRESO = 250
export const MS_TOPE_RETARDO_INGRESO = 30 * 1000

export type FrenoDeIngreso = 'permitido' | 'cuenta_en_espera' | 'origen_en_espera'

const SIN_IP = 'sin-ip-de-fiar'

/** La cuenta como se escribe en cualquier forma ("Ana", " ana ") cuenta igual. */
function cuentaYOrigen(usuario: string, ip: string | null): string {
  return `${usuario.trim().toLowerCase()}|${ip ?? SIN_IP}`
}

/** Si se puede comprobar la contrasena. NO cuenta nada. */
export function frenoDeIngreso(usuario: string, ip: string | null): FrenoDeIngreso {
  if (ip && superaFallos('login_ip', ip, FALLOS_POR_ORIGEN)) return 'origen_en_espera'
  if (ip && superaFallos('login_cuenta_origen', cuentaYOrigen(usuario, ip), FALLOS_POR_CUENTA_Y_ORIGEN)) {
    return 'cuenta_en_espera'
  }
  return superaFallos('login_cuenta', usuario, FALLOS_POR_CUENTA) ? 'cuenta_en_espera' : 'permitido'
}

/**
 * Cuanto esperar antes de comprobar la contrasena cuando no hay IP de fiar.
 * Crece al doble por fallo desde `FALLOS_SIN_RETARDO` y nunca pasa del tope.
 */
export function retardoDeIngresoMs(usuario: string, ip: string | null): number {
  if (ip) return 0
  const exceso = fallosVigentes('login_cuenta_origen', cuentaYOrigen(usuario, ip)) - FALLOS_SIN_RETARDO
  if (exceso < 0) return 0
  return Math.min(MS_TOPE_RETARDO_INGRESO, MS_BASE_RETARDO_INGRESO * 2 ** exceso)
}

/** Cuenta un intento fallido en las tres capas. */
export function apuntarFalloDeIngreso(usuario: string, ip: string | null) {
  if (ip) apuntarFallo('login_ip', ip, MS_VENTANA_INGRESO)
  apuntarFallo('login_cuenta_origen', cuentaYOrigen(usuario, ip), MS_VENTANA_INGRESO)
  apuntarFallo('login_cuenta', usuario, MS_VENTANA_INGRESO)
}

/**
 * Entro bien: se borran los fallos de ESA cuenta, que eran dedazos del dueño.
 * Los del origen no: pueden ser de otras cuentas (ver la cabecera).
 */
export function olvidarFallosDeIngreso(usuario: string, ip: string | null) {
  limpiarIntentos('login_cuenta_origen', cuentaYOrigen(usuario, ip))
  limpiarIntentos('login_cuenta', usuario)
}

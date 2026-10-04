/**
 * Las reglas del PIN de los medicos, iguales para las dos implementaciones del
 * repositorio.
 *
 * SEIS DIGITOS, AL AZAR, UNO POR MEDICO. El PIN solo ya dice quien es (el
 * medico no elige su nombre de una lista), asi que no pueden repetirse: el
 * repositorio vuelve a sortear si sale uno que ya tiene otro.
 *
 * Lo sortea el sistema y no el administrador a proposito: un PIN escogido a
 * mano acaba siendo la fecha de nacimiento, el numero del consultorio o
 * 123456, y esos son los primeros que prueba quien quiere entrar.
 */
import { randomInt } from 'node:crypto'
import { DIGITOS_PIN, esPinFacil } from './forma-pin'

export { DIGITOS_PIN, esPinFacil, esPinValido } from './forma-pin'

/** Un PIN nuevo al azar (con el generador criptografico), nunca de los faciles. */
export function sortearPin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10 ** DIGITOS_PIN)).padStart(DIGITOS_PIN, '0')
    if (!esPinFacil(pin)) return pin
  }
}

/** Cuantas veces se vuelve a sortear si sale un PIN que ya tiene otro medico. */
export const SORTEOS_MAXIMOS = 20

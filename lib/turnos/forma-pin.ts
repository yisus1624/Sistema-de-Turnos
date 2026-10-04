/**
 * La FORMA del PIN de los medicos: cuantos digitos tiene y cuales no se
 * entregan. Sin dependencias del servidor, para que la pantalla de entrada
 * (`app/medico`) use el mismo numero de digitos que el sorteo
 * (`reglas-pin.ts`).
 */
export const DIGITOS_PIN = 6

const FORMA_DEL_PIN = new RegExp(`^\\d{${DIGITOS_PIN}}$`)

export function esPinValido(pin: unknown): pin is string {
  return typeof pin === 'string' && FORMA_DEL_PIN.test(pin)
}

/**
 * Los que no se entregan nunca aunque salgan al azar: todos iguales (111111)
 * o en escalera (123456, 654321). Son los primeros que se prueban.
 */
export function esPinFacil(pin: string): boolean {
  const cifras = [...pin].map(Number)
  const iguales = cifras.every((cifra) => cifra === cifras[0])
  const pasos = cifras.slice(1).map((cifra, i) => cifra - cifras[i])
  const escalera = pasos.every((paso) => paso === 1) || pasos.every((paso) => paso === -1)
  return iguales || escalera
}

/**
 * Proteccion de los datos del paciente en pantallas publicas.
 *
 * La pantalla de la sala de espera no tiene sesion y la ve cualquiera. Mostrar
 * el nombre completo junto al servicio revelaria un dato de salud (que esa
 * persona tiene cita en odontologia, pediatria, etc.), que en Colombia es un
 * dato sensible bajo la Ley 1581 de 2012.
 *
 * Por eso el nombre se enmascara SIEMPRE EN EL SERVIDOR antes de enviarlo a la
 * pantalla: el nombre completo no debe viajar al navegador del televisor.
 * El paciente se identifica por el codigo del turno, que es unico; el nombre
 * parcial solo sirve para que se reconozca.
 *
 * Si el hospital pide por escrito mostrar el nombre completo, se cambia
 * unicamente esta funcion.
 */

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'van', 'von'])

/**
 * "JUAN CARLOS PEREZ GOMEZ" -> "JUAN P."
 *
 * Deja el primer nombre completo y la inicial del primer apellido. Asume el
 * orden colombiano habitual: nombres y despues apellidos.
 */
export function enmascararNombre(nombreCompleto?: string | null): string | null {
  if (!nombreCompleto) return null

  const partes = nombreCompleto
    .trim()
    .split(/\s+/)
    .filter((parte) => parte.length > 0 && !PARTICULAS.has(parte.toLowerCase()))

  if (partes.length === 0) return null

  const enMayuscula = (valor: string) => valor.toLocaleUpperCase('es')
  const primerNombre = enMayuscula(partes[0])

  if (partes.length === 1) return primerNombre

  // Con 3 o mas palabras asumimos que el apellido empieza en la penultima
  // ("JUAN CARLOS PEREZ GOMEZ" -> apellido PEREZ). Con 2, la segunda palabra
  // ya es el apellido.
  const indiceApellido = partes.length >= 3 ? partes.length - 2 : 1
  const inicialApellido = enMayuscula(partes[indiceApellido].charAt(0))

  return `${primerNombre} ${inicialApellido}.`
}

/**
 * Traduccion de "la base rechazo esto por repetido" al aviso del funcionario.
 *
 * Varias reglas de este sistema (el prefijo del servicio, el nombre del
 * consultorio, el cupo de una cita hecha a mano) se comprobaban leyendo y
 * escribiendo despues. Entre la lectura y la escritura cabe otro operador, asi
 * que la comprobacion pasa a estar respaldada por un indice unico de
 * PostgreSQL. Pero un indice que salta le muestra al funcionario un error
 * tecnico ilegible; aqui se convierte en la misma frase que ya daba la
 * validacion previa.
 *
 * La funcion es pura y no toca la base: se le pasa el error y se le pregunta
 * que columna (o que indice) lo provoco.
 */
import { Prisma } from '@prisma/client'

const CHOQUE_DE_UNICO = 'P2002'

/**
 * Columna o nombre del indice que rechazo la escritura; `null` si el error no
 * es un choque de unicidad o si Prisma no dijo cual fue.
 *
 * Prisma informa el objetivo como lista de columnas para los indices normales
 * y como una sola cadena con el nombre del indice para los que se escribieron
 * a mano en la migracion (los parciales y los de expresion, que el esquema de
 * Prisma no sabe declarar).
 */
export function claveDelChoque(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null
  if (error.code !== CHOQUE_DE_UNICO) return null

  const objetivo = error.meta?.target
  if (typeof objetivo === 'string') return objetivo
  if (Array.isArray(objetivo) && typeof objetivo[0] === 'string') return objetivo[0]
  return null
}

/** Verdadero para cualquier rechazo por repetido, sin mirar de que columna. */
export function esChoqueDeUnico(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === CHOQUE_DE_UNICO
}

/**
 * El aviso que corresponde al choque, o `null` si no hay ninguno preparado.
 *
 * Sin mensaje propio se devuelve `null` a proposito, para que el error tecnico
 * suba tal cual: contarle al funcionario que repitio un campo que no toco le
 * hace corregir donde no es.
 */
export function mensajeDeChoque(error: unknown, mensajes: Record<string, string>): string | null {
  const clave = claveDelChoque(error)
  return clave ? (mensajes[clave] ?? null) : null
}

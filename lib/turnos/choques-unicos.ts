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
  if (!Array.isArray(objetivo) || objetivo.length === 0) return null
  const columnas = objetivo.join(',')
  return INDICES_POR_COLUMNAS[`${String(error.meta?.modelName)}:${columnas}`] ?? columnas
}

/**
 * Los indices de varias columnas o de expresion, por lo que Prisma informa.
 *
 * Prisma 6 con PostgreSQL NO da el nombre del indice: pone en `meta.target` sus
 * columnas (o la expresion) y el modelo en `meta.modelName` (comprobado contra
 * PostgreSQL 16). Sin esta tabla el cupo manual salia como 'fecha' y el nombre
 * normalizado como la expresion cruda, y los dos acababan en un 500.
 */
const INDICES_POR_COLUMNAS: Record<string, string> = {
  'Cita:fecha,profesionalId,horaCita': 'citas_cupo_manual_unico',
  'Cita:fecha,documentoPaciente,profesionalId,horaCita': 'citaDelDia',
  'Modulo:lower(TRIM(BOTH FROM nombre))': 'modulos_nombre_normalizado_unico',
  'Servicio:lower(TRIM(BOTH FROM nombre))': 'servicios_nombre_normalizado_unico',
  'Profesional:lower(TRIM(BOTH FROM nombre))': 'profesionales_nombre_normalizado_unico',
}

/**
 * Errores de transaccion que se arreglan repitiendo: P2028 (la transaccion no
 * consiguio conexion o se paso de tiempo), P2034 (conflicto de escritura o
 * bloqueo mutuo) y el 40P01 de PostgreSQL (deadlock) cuando llega por una
 * consulta en crudo.
 */
export function esConflictoPasajero(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code === 'P2028' || error.code === 'P2034') return true
  return error.code === 'P2010' && /40P01|deadlock/i.test(`${JSON.stringify(error.meta ?? {})} ${error.message}`)
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

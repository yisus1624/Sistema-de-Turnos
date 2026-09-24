/**
 * Mensajes de validacion de Zod en español.
 *
 * Los esquemas sin mensaje propio devolvian el de Zod en ingles ("String must
 * contain at most 60 character(s)") y las rutas lo pasaban tal cual al
 * usuario. Este mapa solo actua cuando el esquema NO trae su mensaje: los que
 * ya estaban escritos en español no cambian.
 */
import { z, ZodIssueCode, type ZodErrorMap, type ZodIssueOptionalMessage } from 'zod'

const DATO_INVALIDO = 'El dato no es valido.'

type Medida = Extract<ZodIssueOptionalMessage, { code: 'too_big' | 'too_small' }>

function unidad(issue: Medida): string {
  if (issue.type === 'string') return 'caracteres'
  if (issue.type === 'array' || issue.type === 'set') return 'elementos'
  return ''
}

function limite(issue: Medida): number | bigint {
  return issue.code === 'too_big' ? issue.maximum : issue.minimum
}

function conUnidad(texto: string, issue: Medida): string {
  const cuanto = `${texto} ${String(limite(issue))} ${unidad(issue)}`.trimEnd()
  return `${cuanto}.`
}

function demasiadoGrande(issue: Extract<Medida, { code: 'too_big' }>): string {
  return issue.type === 'string' || issue.type === 'array' || issue.type === 'set'
    ? conUnidad('No puede pasar de', issue)
    : conUnidad('No puede ser mayor que', issue)
}

function demasiadoPequeno(issue: Extract<Medida, { code: 'too_small' }>): string {
  if (issue.type === 'string' && issue.minimum === 1) return 'Este campo es obligatorio.'
  return issue.type === 'string' || issue.type === 'array' || issue.type === 'set'
    ? conUnidad('Debe tener al menos', issue)
    : conUnidad('No puede ser menor que', issue)
}

function mensajeDe(issue: ZodIssueOptionalMessage): string {
  if (issue.code === ZodIssueCode.invalid_type) {
    return issue.received === 'undefined' ? 'Falta un dato obligatorio.' : DATO_INVALIDO
  }
  if (issue.code === ZodIssueCode.too_big) return demasiadoGrande(issue)
  if (issue.code === ZodIssueCode.too_small) return demasiadoPequeno(issue)
  if (issue.code === ZodIssueCode.invalid_enum_value) return 'Elige una de las opciones disponibles.'
  if (issue.code === ZodIssueCode.invalid_string) return 'El formato no es valido.'
  return DATO_INVALIDO
}

export const mapaDeErroresEnEspanol: ZodErrorMap = (issue) => ({ message: mensajeDe(issue) })

/** Deja el mapa en español como el de todo el proceso. Llamarlo dos veces no cambia nada. */
export function instalarMensajesEnEspanol(): void {
  z.setErrorMap(mapaDeErroresEnEspanol)
}

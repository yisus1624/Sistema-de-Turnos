/**
 * Como se nombra un consultorio en el TELEVISOR.
 *
 * El reporte del hospital trae nombres como "CONS 01- CONSULTA EXTERNA" o
 * "CONS 02 - ODONTOLOGIA PYM": un numero y de que servicio es. En la sala de
 * espera se lee mejor partido en dos: el lugar ("ODONTOLOGIA PYM") y, aparte y
 * grande, el numero ("2"), que es lo que el paciente busca en la puerta.
 *
 * Solo cambia lo que se MUESTRA: en la base el consultorio sigue llamandose
 * como lo trae el reporte, que es con lo que la carga diaria lo reconoce. Un
 * nombre que no sigue ese patron ("FISIOTERAPIA") queda como lugar, sin numero.
 */

const PATRON = /^\s*CONS(?:ULTORIO)?\.?\s*(?:SIM\s*)?0*(\d+)\s*[-–]?\s*(.*)$/i

/**
 * Marca invisible entre el lugar y el numero dentro de `moduloNombre`, para
 * que la casilla viaje igual que siempre y la cartelera sepa partirla. Quien
 * mide el texto (ver `medirTextos`) mide solo el lugar: el hueco del numero lo
 * reserva aparte, fijo.
 */
export const MARCA_DE_NUMERO = '⁣'

/** Mayusculas y sin tildes, para comparar palabras. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleUpperCase('es')
}

export interface PartesDeConsultorio {
  /** Donde es: el servicio y lo que el nombre agrega ("ODONTOLOGIA PYM"), o el nombre si no es "CONS N". */
  lugar: string
  /** El numero del consultorio, o null si el nombre no lo trae. */
  numero: string | null
}

export function partesDeConsultorio(nombre: string, servicio: string): PartesDeConsultorio {
  const partes = PATRON.exec(nombre)
  if (!partes) return { lugar: nombre, numero: null }

  const [, numero, resto] = partes
  const delServicio = normalizar(servicio).trim()
  const palabrasDelServicio = new Set(delServicio.split(/\s+/).filter(Boolean))
  const extra = normalizar(resto)
    .split(/\s+/)
    .filter((palabra) => palabra && !palabrasDelServicio.has(palabra))
    .join(' ')

  return { lugar: [delServicio, extra].filter(Boolean).join(' ') || 'CONSULTORIO', numero }
}

/**
 * El nombre corto para la CUADRICULA, que ya agrupa por servicio bajo su
 * titulo: "CONSULTORIO 2" (y lo que distinga, "CONSULTORIO 3 · PYM").
 */
export function nombreDeConsultorioEnPantalla(nombre: string, servicio: string): string {
  if (!PATRON.test(nombre)) return nombre
  const { numero, lugar } = partesDeConsultorio(nombre, servicio)
  const extra = lugar.replace(normalizar(servicio).trim(), '').trim()
  return extra ? `CONSULTORIO ${numero} · ${extra}` : `CONSULTORIO ${numero}`
}

/** Parte `moduloNombre` de la cartelera en lugar y numero (ver `MARCA_DE_NUMERO`). */
export function leerLugarYNumero(moduloNombre: string): PartesDeConsultorio {
  const corte = moduloNombre.indexOf(MARCA_DE_NUMERO)
  if (corte < 0) return { lugar: moduloNombre, numero: null }
  return { lugar: moduloNombre.slice(0, corte), numero: moduloNombre.slice(corte + MARCA_DE_NUMERO.length) }
}

/** Las casillas con el consultorio como se lee en el televisor, segun el diseño. */
export function conNombresDePantalla<T extends { moduloNombre: string; servicioNombre: string }>(
  casillas: T[],
  diseno: 'cartelera' | 'cuadricula',
): T[] {
  return casillas.map((c) => {
    if (diseno === 'cuadricula') return { ...c, moduloNombre: nombreDeConsultorioEnPantalla(c.moduloNombre, c.servicioNombre) }
    const { lugar, numero } = partesDeConsultorio(c.moduloNombre, c.servicioNombre)
    return { ...c, moduloNombre: numero ? `${lugar}${MARCA_DE_NUMERO}${numero}` : lugar }
  })
}

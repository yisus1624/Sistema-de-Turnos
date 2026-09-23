/**
 * La geometria de una fila de la CARTELERA, en sus dos formas.
 *
 * - `una-planta`: la pieza aprobada. Turno, medico y consultorio lado a lado.
 * - `dos-pisos`: el consultorio y, debajo, el medico, junto al turno. Pide
 *   mucho menos ancho y algo mas de alto: es lo que deja crecer la letra en un
 *   televisor vertical o 4:3, y lo que deja repartir doce consultorios en dos
 *   columnas en vez de rotar paginas. Con una planta, la fila pedia a la vez
 *   el hueco de un nombre largo de medico y el de un consultorio largo, y el
 *   ancho se acababa antes que el alto.
 *
 * Cada forma sabe cuanto ancho y cuanto alto pide para una letra dada; quien
 * elige entre ellas es `distribucion-cartelera.ts`. Medidas en "em" de cada
 * letra, las mismas con que las pinta `FilaCartelera`.
 */
import { lineasQueOcupa, type Espacio, type Letra, type MedidaDeTextos } from './legibilidad-pantalla'

export type FormaDeFila = 'una-planta' | 'dos-pisos'

/** La celda del codigo mide el codigo mas largo mas el relleno de su pastilla (0,35 em a cada lado): NUNCA se parte. */
const RELLENO_TURNO_EM = 0.7
/** La pastilla del codigo: 1 em de letra mas 0,12 em arriba y abajo. */
const ALTO_TURNO_EM = 1.24
const ALTO_LINEA_EM = 1.1
/**
 * La pastilla del consultorio: relleno vertical, y a lo ancho relleno, icono,
 * hueco y la cajita del NUMERO del consultorio (2,3 em mas su aire), que va
 * dentro de la pastilla, a la derecha.
 */
const RELLENO_PASTILLA_EM = 0.4
export const ADORNO_PASTILLA_EM = 2.1 + 2.6
const ALTO_SERVICIO_EM = 1.25
/** Por angosta que salga una celda de texto, que quepa al menos una palabra larga. */
const ANCHO_MINIMO_TEXTO_EM = 6
/** En dos pisos, el aire entre la pastilla del consultorio y el medico. */
const SEPARACION_PISOS_EM = 0.15

/** Aire de la fila: proporcional a la letra, para que en 4K no quede apretada. */
const RELLENO_VERTICAL_EM = 0.06
const RELLENO_HORIZONTAL_EM = 0.35
const SEPARACION_CELDAS_EM = 0.4

/** Ancho de la celda de cada texto (en dos pisos, medico y consultorio comparten la misma). */
export interface CeldasDeFila {
  turno: number
  medico: number
  consultorio: number
}

export const rellenoX = (letra: Letra) => Math.round(RELLENO_HORIZONTAL_EM * letra.consultorio)
export const separacionCeldas = (letra: Letra) => Math.round(SEPARACION_CELDAS_EM * letra.consultorio)
export const separacionPisos = (forma: FormaDeFila, letra: Letra) =>
  forma === 'dos-pisos' ? Math.round(SEPARACION_PISOS_EM * letra.consultorio) : 0

const anchoTurno = (letra: Letra, textos: MedidaDeTextos) => Math.ceil((textos.turno + RELLENO_TURNO_EM) * letra.turno)

/** Lo que pide cada texto para caber en dos lineas, en pixeles. */
function anchoPedido(letra: Letra, textos: MedidaDeTextos): { medico: number; consultorio: number } {
  const em = (dosLineas: number) => Math.max(ANCHO_MINIMO_TEXTO_EM, dosLineas)
  return {
    medico: em(textos.medico.dosLineas) * letra.medico,
    consultorio: (em(textos.consultorio.dosLineas) + ADORNO_PASTILLA_EM) * letra.consultorio,
  }
}

/** Lineas y alto de cada texto en su celda. */
function altoDeTextos(letra: Letra, textos: MedidaDeTextos, celdas: CeldasDeFila, conServicio: boolean) {
  const lineasMedico = lineasQueOcupa(textos.medico, celdas.medico / letra.medico)
  const lineasConsultorio = lineasQueOcupa(textos.consultorio, celdas.consultorio / letra.consultorio - ADORNO_PASTILLA_EM)
  const servicio = conServicio ? ALTO_SERVICIO_EM * letra.servicio : 0
  return {
    medico: lineasMedico * ALTO_LINEA_EM * letra.medico + servicio,
    consultorio: (lineasConsultorio * ALTO_LINEA_EM + RELLENO_PASTILLA_EM) * letra.consultorio,
  }
}

interface GeometriaDeFila {
  /** Los huecos entre celdas de la fila. */
  separaciones: number
  anchoDeTextos: (pedido: { medico: number; consultorio: number }) => number
  celdasDeTextos: (resto: number, pedido: { medico: number; consultorio: number }) => Omit<CeldasDeFila, 'turno'>
  reja: (celdas: CeldasDeFila) => number[]
  altoDeTextos: (alto: { medico: number; consultorio: number }, letra: Letra) => number
}

/** Una tabla de formas y no un `if` por cada medida: una forma nueva es una entrada nueva. */
const GEOMETRIAS: Record<FormaDeFila, GeometriaDeFila> = {
  'una-planta': {
    separaciones: 2,
    anchoDeTextos: (pedido) => pedido.medico + pedido.consultorio,
    celdasDeTextos: (resto, pedido) => {
      const medico = Math.floor((resto * pedido.medico) / (pedido.medico + pedido.consultorio))
      return { medico, consultorio: Math.floor(resto - medico) }
    },
    reja: (celdas) => [celdas.turno, celdas.medico, celdas.consultorio],
    altoDeTextos: (alto) => Math.max(alto.medico, alto.consultorio),
  },
  'dos-pisos': {
    separaciones: 1,
    anchoDeTextos: (pedido) => Math.max(pedido.medico, pedido.consultorio),
    celdasDeTextos: (resto) => ({ medico: Math.floor(resto), consultorio: Math.floor(resto) }),
    reja: (celdas) => [celdas.turno, celdas.consultorio],
    altoDeTextos: (alto, letra) => alto.consultorio + separacionPisos('dos-pisos', letra) + alto.medico,
  },
}

const aireLateral = (forma: FormaDeFila, letra: Letra) =>
  2 * rellenoX(letra) + GEOMETRIAS[forma].separaciones * separacionCeldas(letra)

export function anchoNecesario(forma: FormaDeFila, letra: Letra, textos: MedidaDeTextos): number {
  const deTextos = GEOMETRIAS[forma].anchoDeTextos(anchoPedido(letra, textos))
  return anchoTurno(letra, textos) + deTextos + aireLateral(forma, letra)
}

/** Lo que queda de la columna despues del codigo se reparte entre los textos. */
export function celdasDe(forma: FormaDeFila, letra: Letra, entrada: { ancho: number; textos: MedidaDeTextos }): CeldasDeFila {
  const turno = anchoTurno(letra, entrada.textos)
  const resto = Math.max(0, entrada.ancho - turno - aireLateral(forma, letra))
  return { turno, ...GEOMETRIAS[forma].celdasDeTextos(resto, anchoPedido(letra, entrada.textos)) }
}

/** El ancho de cada columna de la reja de la fila; el encabezado usa la misma. */
export function rejaDe(forma: FormaDeFila, celdas: CeldasDeFila): number[] {
  return GEOMETRIAS[forma].reja(celdas)
}

/** Lo que pide de alto la fila; los textos, en una linea si les cabe. */
export function altoNecesario(
  forma: FormaDeFila,
  letra: Letra,
  fila: { ancho: number; textos: MedidaDeTextos; conServicio: boolean },
): number {
  const celdas = celdasDe(forma, letra, fila)
  const textos = GEOMETRIAS[forma].altoDeTextos(altoDeTextos(letra, fila.textos, celdas, fila.conServicio), letra)
  return Math.max(ALTO_TURNO_EM * letra.turno, textos) + 2 * RELLENO_VERTICAL_EM * letra.turno
}

export const cabeEnFila = (forma: FormaDeFila, textos: MedidaDeTextos, fila: Espacio) => (letra: Letra) =>
  anchoNecesario(forma, letra, textos) <= fila.ancho &&
  altoNecesario(forma, letra, { ancho: fila.ancho, textos, conServicio: false }) <= fila.alto

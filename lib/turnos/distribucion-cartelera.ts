/**
 * Como se reparten las filas de la CARTELERA en cualquier televisor.
 *
 * Primero la letra y despues la fila: se busca la letra mas grande (dentro de
 * lo que se lee de lejos, ver `legibilidad-pantalla.ts`) con la que el turno,
 * el medico y el consultorio caben en la fila, y la fila crece para llenar el
 * alto. Se prueban las dos formas de fila (ver `filas-de-cartelera.ts`) y
 * cuantas columnas hagan falta; gana la que deja el turno mas grande y, si
 * empatan, la de una planta, que es la pieza aprobada.
 *
 * Si con la letra minima no caben, mas columnas; y solo al final, paginas.
 */
import {
  ajustarATextos,
  espacioUtil,
  ladoCorto,
  letraConEscala,
  MAXIMO_EN_UNA_PANTALLA,
  mayorLetra,
  medirTextos,
  rangosEnUnaPantalla,
  textosReservados,
  type Espacio,
  type Letra,
  type MedidaDeTextos,
  type RangoDeLetra,
  type TextosDeCasilla,
} from './legibilidad-pantalla'
import {
  ADORNO_PASTILLA_EM,
  altoNecesario,
  anchoNecesario,
  cabeEnFila,
  celdasDe,
  rejaDe,
  rellenoX,
  separacionCeldas,
  separacionPisos,
  type CeldasDeFila,
  type FormaDeFila,
} from './filas-de-cartelera'

export type { CeldasDeFila, FormaDeFila }

/**
 * El tope es el tamaño que la letra tiene con 8 a 10 consultorios, que es la
 * jornada normal del hospital: turno hasta el 5,5 % del lado corto (~60 px en
 * 1080p) y medico y consultorio hasta el 3,4 % (~37 px). Antes llegaba al 9 %,
 * y con un solo turno la fila ocupaba media pantalla y la letra se achicaba a
 * medida que llegaban mas: la pantalla cambiaba de cara a lo largo del dia.
 * Con el tope, el tamaño es el mismo de 1 a 10 consultorios; solo con mas baja,
 * sin pasar nunca del minimo legible.
 */
const RANGO_CARTELERA: RangoDeLetra = { turno: [0.045, 0.055], texto: [0.028, 0.034] }

/** Primero la pieza aprobada: con empate, gana la fila de una planta. */
const FORMAS: readonly FormaDeFila[] = ['una-planta', 'dos-pisos']

/**
 * Cuanto puede crecer la fila por encima de lo que pide su letra: nada de
 * filas delgadas en una tabla vacia, pero sin estirarlas tanto que el turno
 * flote en medio de una banda azul. Con una o dos filas por columna hay mucho
 * mas alto que repartir.
 */
const HOLGURA_DE_FILA = 1.3
const HOLGURA_CON_POCAS_FILAS = HOLGURA_DE_FILA
/** Hasta cuantas filas la tabla es "de pocas filas": todo el ancho, mas holgura y centrada. */
export const POCAS_FILAS = 2

/**
 * Entre cuantas filas la tabla deja ver la foto a su izquierda, y desde que
 * proporcion de pantalla. Con una o dos filas la tabla usa todo el ancho (la
 * foto queda de fondo): ahi el ancho es lo que limitaba la letra. Con muchas,
 * tambien: es lo que deja repartirlas en columnas. En 4:3 y en vertical no hay
 * ancho que ceder.
 */
const FILAS_CON_FOTO = { desde: 1, hasta: 5 }
const PROPORCION_MINIMA_CON_FOTO = 1.5

export function tablaConFoto(filas: number, pantalla: Espacio): boolean {
  const panoramica = pantalla.alto > 0 && pantalla.ancho / pantalla.alto >= PROPORCION_MINIMA_CON_FOTO
  return panoramica && filas >= FILAS_CON_FOTO.desde && filas <= FILAS_CON_FOTO.hasta
}

export interface PlanDeCartelera {
  forma: FormaDeFila
  columnas: number
  altoFila: number
  anchoColumna: number
  /** Filas por pagina (todas, si caben en una). */
  porPagina: number
  paginas: number
  letra: Letra
  /** Ancho de la celda de cada texto, en pixeles. */
  celdas: CeldasDeFila
  /** Ancho de cada columna de la fila: la cabecera usa la misma reja. */
  reja: number[]
  rellenoX: number
  separacionCeldas: number
  /** En dos pisos, el aire entre el consultorio y el medico. */
  separacionPisos: number
  separacionFilas: number
  separacionColumnas: number
  /** Si el nombre del servicio cabe bajo el medico sin achicar nada. */
  conServicio: boolean
}

/** Lo que no cambia mientras se prueban formas, columnas y letras. */
interface Contexto {
  lado: number
  separacionFilas: number
  separacionColumnas: number
  /** Lo que miden el codigo, el medico y el consultorio mas largos (topados, ver `textosReservados`). */
  textos: MedidaDeTextos
}

function contextoDe(pantalla: Espacio, filas: TextosDeCasilla[]): Contexto {
  const lado = ladoCorto(pantalla)
  return {
    lado,
    separacionFilas: Math.max(6, Math.round(lado * 0.006)),
    separacionColumnas: Math.max(12, Math.round(lado * 0.015)),
    textos: textosReservados(medirTextos(filas)),
  }
}

// --- Reparto en formas, columnas y paginas --------------------------------------

interface Reparto {
  forma: FormaDeFila
  columnas: number
  filasPorColumna: number
  fila: Espacio
}

interface Eleccion {
  reparto: Reparto
  letra: Letra
}

function anchoDeColumna(util: Espacio, ctx: Contexto, columnas: number): number {
  return Math.max(1, Math.floor((util.ancho - (columnas - 1) * ctx.separacionColumnas) / columnas))
}

function repartoCon(util: Espacio, ctx: Contexto, reja: Omit<Reparto, 'fila'>): Reparto {
  const alto = Math.floor((util.alto - (reja.filasPorColumna - 1) * ctx.separacionFilas) / reja.filasPorColumna)
  return { ...reja, fila: { ancho: anchoDeColumna(util, ctx, reja.columnas), alto } }
}

function eleccionCon(ctx: Contexto, reparto: Reparto, rango: RangoDeLetra = RANGO_CARTELERA): Eleccion | null {
  const cabe = cabeEnFila(reparto.forma, ctx.textos, reparto.fila)
  const letra = mayorLetra({ lado: ctx.lado, rango, cabe })
  return letra ? { reparto, letra } : null
}

/** Todas en una pagina: la forma y las columnas que dejan la letra mas grande, o null si ninguna llega al minimo. */
function todasEnUnaPagina(util: Espacio, ctx: Contexto, filas: number, rango: RangoDeLetra): Eleccion | null {
  let mejor: Eleccion | null = null
  for (const forma of FORMAS) {
    for (let columnas = 1; columnas <= filas; columnas += 1) {
      const reparto = repartoCon(util, ctx, { forma, columnas, filasPorColumna: Math.ceil(filas / columnas) })
      const eleccion = eleccionCon(ctx, reparto, rango)
      if (eleccion && (!mejor || eleccion.letra.turno > mejor.letra.turno)) mejor = eleccion
    }
  }
  return mejor
}

/** Cuantas filas de letra minima caben a lo alto en columnas de `ancho`, o 0 si ni a lo ancho cabe. */
function filasQueCaben(util: Espacio, ctx: Contexto, columna: { forma: FormaDeFila; ancho: number }): number {
  const minima = letraConEscala(0, ctx.lado, RANGO_CARTELERA)
  if (anchoNecesario(columna.forma, minima, ctx.textos) > columna.ancho) return 0
  const alto = altoNecesario(columna.forma, minima, { ancho: columna.ancho, textos: ctx.textos, conServicio: false })
  return Math.floor((util.alto + ctx.separacionFilas) / (alto + ctx.separacionFilas))
}

/** La reja de una forma que deja mas filas por pagina con la letra minima. */
function mayorRepartoDe(util: Espacio, ctx: Contexto, forma: FormaDeFila): Reparto | null {
  let mejor: Reparto | null = null
  for (let columnas = 1; ; columnas += 1) {
    const filasPorColumna = filasQueCaben(util, ctx, { forma, ancho: anchoDeColumna(util, ctx, columnas) })
    if (filasPorColumna === 0) return mejor
    if (!mejor || columnas * filasPorColumna > mejor.columnas * mejor.filasPorColumna) {
      mejor = repartoCon(util, ctx, { forma, columnas, filasPorColumna })
    }
  }
}

const porPaginaDe = (reparto: Reparto | null) => (reparto ? reparto.columnas * reparto.filasPorColumna : 0)

/**
 * Ultimo recurso: la forma y las columnas que dejan mas filas por pagina con
 * la letra minima. En un monitor tan pequeño que ni una fila llega al minimo,
 * una sola con la letra minima: mejor apretada que ilegible.
 */
function paginado(util: Espacio, ctx: Contexto): Eleccion {
  const mejor = FORMAS.map((forma) => mayorRepartoDe(util, ctx, forma)).reduce((a, b) => (porPaginaDe(b) > porPaginaDe(a) ? b : a))
  const reparto = mejor ?? repartoCon(util, ctx, { forma: 'dos-pisos', columnas: 1, filasPorColumna: 1 })
  return eleccionCon(ctx, reparto) ?? { reparto, letra: letraConEscala(0, ctx.lado, RANGO_CARTELERA) }
}

// --- El plan -------------------------------------------------------------------

/** El medico y el consultorio, ya con la letra que les deja su texto mas largo (sin topar). */
function conTextos(letra: Letra, ctx: Contexto, entrada: { filas: TextosDeCasilla[]; celdas: CeldasDeFila }): Letra {
  const textos = medirTextos(entrada.filas)
  return ajustarATextos(letra, ctx.lado, {
    medico: { texto: textos.medico, ancho: entrada.celdas.medico, rellenoEm: 0 },
    consultorio: { texto: textos.consultorio, ancho: entrada.celdas.consultorio, rellenoEm: ADORNO_PASTILLA_EM },
  })
}

function altoDeFila(letra: Letra, ctx: Contexto, reparto: Reparto): { altoFila: number; conServicio: boolean } {
  const { forma, fila } = reparto
  const medida = (conServicio: boolean) => altoNecesario(forma, letra, { ancho: fila.ancho, textos: ctx.textos, conServicio })
  const conServicio = medida(true) <= fila.alto
  const holgura = reparto.filasPorColumna <= POCAS_FILAS ? HOLGURA_CON_POCAS_FILAS : HOLGURA_DE_FILA
  return { altoFila: Math.min(fila.alto, Math.round(medida(conServicio) * holgura)), conServicio }
}

function planDesde(eleccion: Eleccion, ctx: Contexto, filas: TextosDeCasilla[]): PlanDeCartelera {
  const { reparto } = eleccion
  const celdas = celdasDe(reparto.forma, eleccion.letra, { ancho: reparto.fila.ancho, textos: ctx.textos })
  const letra = conTextos(eleccion.letra, ctx, { filas, celdas })
  const porPagina = reparto.columnas * reparto.filasPorColumna
  return {
    ...altoDeFila(letra, ctx, reparto),
    forma: reparto.forma,
    columnas: reparto.columnas,
    anchoColumna: reparto.fila.ancho,
    porPagina,
    paginas: Math.max(1, Math.ceil(filas.length / porPagina)),
    letra,
    celdas,
    reja: rejaDe(reparto.forma, celdas),
    rellenoX: rellenoX(eleccion.letra),
    separacionCeldas: separacionCeldas(eleccion.letra),
    separacionPisos: separacionPisos(reparto.forma, letra),
    separacionFilas: ctx.separacionFilas,
    separacionColumnas: ctx.separacionColumnas,
  }
}

/**
 * El plan de la cartelera para los turnos en curso (`filas`) en el `espacio`
 * medido de la tabla. De cada fila solo mira cuanto miden sus textos.
 */
export function planDeCartelera(espacio: Espacio, filas: TextosDeCasilla[], pantalla: Espacio): PlanDeCartelera {
  const util = espacioUtil(espacio)
  const ctx = contextoDe(pantalla, filas)
  const cantidad = Math.max(1, filas.length)
  // Hasta `MAXIMO_EN_UNA_PANTALLA` turnos, todos a la vista: si con la letra
  // normal no caben, se aprieta un poco antes que pasar a una pagina 2.
  const rangos = cantidad <= MAXIMO_EN_UNA_PANTALLA ? rangosEnUnaPantalla(RANGO_CARTELERA) : [RANGO_CARTELERA]
  let eleccion: Eleccion | null = null
  for (const rango of rangos) {
    eleccion = todasEnUnaPagina(util, ctx, cantidad, rango)
    if (eleccion) break
  }
  eleccion ??= paginado(util, ctx)
  return planDesde(eleccion, ctx, filas)
}

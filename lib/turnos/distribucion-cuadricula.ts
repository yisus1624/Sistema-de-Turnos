/**
 * Como se reparten las tarjetas de la CUADRICULA en cualquier televisor.
 *
 * Cada reja posible (columnas x filas) se mide por la letra mas grande que
 * deja dentro de sus tarjetas (ver `legibilidad-pantalla.ts`), y gana la que
 * deja el turno mas grande. Si ninguna llega a la letra minima, se prueba sin
 * las etiquetas de servicio y, como ultimo recurso, en paginas que rotan.
 */
import {
  ajustarATextos,
  espacioUtil,
  ladoCorto,
  letraConEscala,
  lineasQueOcupa,
  MAXIMO_EN_UNA_PANTALLA,
  mayorLetra,
  medirTextos,
  rangosEnUnaPantalla,
  textosReservados,
  type AnchoDeTexto,
  type Espacio,
  type Letra,
  type MedidaDeTextos,
  type RangoDeLetra,
  type TextosDeCasilla,
} from './legibilidad-pantalla'

/**
 * En la cuadricula cada tarjeta es UN consultorio: con pocos, el turno puede
 * ser de cartel (hasta el 20 % del lado corto) sin que nada deje de leerse.
 */
// Mismo criterio que la cartelera: tope en el tamaño de una jornada normal,
// para que un solo consultorio no llene la pantalla con una tarjeta gigante.
const RANGO_CUADRICULA: RangoDeLetra = { turno: [0.045, 0.09], texto: [0.028, 0.04], curvaTurno: 1.5 }

/**
 * Medidas de la tarjeta en "em" de cada letra: el consultorio arriba, el
 * codigo en medio y el medico abajo. El codigo, en una sola linea; el
 * consultorio y el medico, en una si les cabe y si no en dos.
 */
const RELLENO_TURNO_EM = 0.85
const ALTO_TURNO_EM = 1.35
const ALTO_LINEA_EM = 1.12
/** Relleno de las bandas del consultorio y del medico: arriba y abajo, y a los lados. */
const RELLENO_VERTICAL_BANDA_EM = 0.8
const RELLENO_BANDA_EM = 1
/** Por angosta que salga una tarjeta, que quepa al menos una palabra larga. */
const ANCHO_MINIMO_TEXTO_EM = 6

/** Una casilla de la cuadricula: su bloque (servicio) y lo que se escribe en ella. */
export interface CasillaDeCuadricula extends TextosDeCasilla {
  grupo: string
}

export interface PaginaDeCuadricula {
  /** Casillas de esta pagina: del indice `desde` (incluido) a `hasta` (excluido). */
  desde: number
  hasta: number
  columnas: number
  /** Filas de tarjetas, sumando las de todos los bloques de la pagina. */
  filas: number
  altoTarjeta: number
  anchoTarjeta: number
  letra: Letra
  /**
   * Si lleva la etiqueta de cada servicio. Antes de paginar se prueba sin
   * ellas: el nombre del consultorio ya dice el servicio, y ese espacio puede
   * ser justo lo que hace que todas quepan en una pantalla.
   */
  conEncabezados: boolean
}

export interface PlanDeCuadricula {
  paginas: PaginaDeCuadricula[]
  /** Separacion entre tarjetas y bloques, y alto de la etiqueta de servicio: crecen con la pantalla. */
  separacion: number
  altoEncabezado: number
}

type Reja = Omit<PaginaDeCuadricula, 'desde' | 'hasta' | 'conEncabezados'>

interface Medidas {
  lado: number
  /** Con que rango de letra se busca (el normal, o uno apretado para que quepan todos). */
  rango: RangoDeLetra
  separacion: number
  altoEncabezado: number
  /** Lo que miden el codigo, el medico y el consultorio mas largos (topados, ver `textosReservados`). */
  textos: MedidaDeTextos
}

function medidasDe(pantalla: Espacio, casillas: TextosDeCasilla[]): Medidas {
  const lado = ladoCorto(pantalla)
  return {
    lado,
    rango: RANGO_CUADRICULA,
    separacion: Math.max(12, Math.round(lado * 0.015)),
    altoEncabezado: Math.max(36, Math.round(lado * 0.042)),
    textos: textosReservados(medirTextos(casillas)),
  }
}

/** Alto de una banda de texto (consultorio o medico) en una tarjeta de `ancho`. */
function altoDeBanda(texto: AnchoDeTexto, letra: number, ancho: number): number {
  const lineas = lineasQueOcupa(texto, ancho / letra - RELLENO_BANDA_EM)
  return (lineas * ALTO_LINEA_EM + RELLENO_VERTICAL_BANDA_EM) * letra
}

function anchoNecesario(letra: Letra, textos: MedidaDeTextos): number {
  const banda = (texto: AnchoDeTexto, tamano: number) => (Math.max(ANCHO_MINIMO_TEXTO_EM, texto.dosLineas) + RELLENO_BANDA_EM) * tamano
  const turno = (textos.turno + RELLENO_TURNO_EM) * letra.turno
  return Math.max(turno, banda(textos.consultorio, letra.consultorio), banda(textos.medico, letra.medico))
}

function altoNecesario(letra: Letra, textos: MedidaDeTextos, ancho: number): number {
  const bandas = altoDeBanda(textos.consultorio, letra.consultorio, ancho) + altoDeBanda(textos.medico, letra.medico, ancho)
  return ALTO_TURNO_EM * letra.turno + bandas
}

const cabeEnTarjeta = (textos: MedidaDeTextos, tarjeta: Espacio) => (letra: Letra) =>
  anchoNecesario(letra, textos) <= tarjeta.ancho && altoNecesario(letra, textos, tarjeta.ancho) <= tarjeta.alto

/** Cuantas casillas tiene cada bloque, en el orden en que aparecen (ya agrupadas). */
function conteosDeGrupos(claves: string[]): number[] {
  const conteos: number[] = []
  claves.forEach((clave, i) => {
    if (i === 0 || clave !== claves[i - 1]) conteos.push(1)
    else conteos[conteos.length - 1] += 1
  })
  return conteos
}

function tarjetaCon(espacio: Espacio, m: Medidas, reja: { columnas: number; filas: number; bloques: number }): Espacio {
  const { columnas, filas, bloques } = reja
  const altoLibre = espacio.alto - bloques * m.altoEncabezado - (filas + bloques - 1) * m.separacion
  return {
    alto: Math.floor(altoLibre / filas),
    ancho: Math.floor((espacio.ancho - (columnas - 1) * m.separacion) / columnas),
  }
}

/** La reja con `columnas`, o null si con ella la letra no llega al minimo. */
function rejaCon(espacio: Espacio, m: Medidas, bloque: { conteos: number[]; columnas: number }): Reja | null {
  const { conteos, columnas } = bloque
  const filas = conteos.reduce((suma, n) => suma + Math.ceil(n / columnas), 0)
  const tarjeta = tarjetaCon(espacio, m, { columnas, filas, bloques: conteos.length })
  const letra = mayorLetra({ lado: m.lado, rango: m.rango, cabe: cabeEnTarjeta(m.textos, tarjeta) })
  return letra ? { columnas, filas, altoTarjeta: tarjeta.alto, anchoTarjeta: tarjeta.ancho, letra } : null
}

/** Gana el turno mas grande; si empatan (las dos en el maximo), la tarjeta mayor. */
function esMejor(reja: Reja, mejor: Reja | null): boolean {
  if (!mejor) return true
  if (reja.letra.turno !== mejor.letra.turno) return reja.letra.turno > mejor.letra.turno
  return reja.altoTarjeta * reja.anchoTarjeta > mejor.altoTarjeta * mejor.anchoTarjeta
}

/** La reja que deja la letra mas grande, o null si ninguna llega al minimo. */
function mejorReja(espacio: Espacio, m: Medidas, conteos: number[]): Reja | null {
  let mejor: Reja | null = null
  for (let columnas = 1; columnas <= Math.max(...conteos); columnas += 1) {
    const reja = rejaCon(espacio, m, { conteos, columnas })
    if (reja && esMejor(reja, mejor)) mejor = reja
  }
  return mejor
}

/**
 * Las filas de un solo bloque sin etiqueta: se calcula como un grupo con el
 * alto de su encabezado devuelto al espacio.
 */
function mejorRejaSinEncabezados(espacio: Espacio, m: Medidas, cantidad: number): Reja | null {
  return mejorReja({ ...espacio, alto: espacio.alto + m.altoEncabezado + m.separacion }, m, [cantidad])
}

/**
 * Las casillas de `desde` a `hasta` en una pagina, con las etiquetas de
 * servicio o sin ellas: lo que deje la letra mas grande (con empate, con
 * etiquetas). Sin ellas caben mas por pagina, y cada pagina de menos es una
 * espera de menos para quien busca su turno.
 */
function paginaCon(espacio: Espacio, m: Medidas, tramo: { claves: string[]; desde: number; hasta: number }): PaginaDeCuadricula | null {
  const { claves, desde, hasta } = tramo
  const agrupada = mejorReja(espacio, m, conteosDeGrupos(claves.slice(desde, hasta)))
  const junta = mejorRejaSinEncabezados(espacio, m, hasta - desde)
  if (junta && esMejor(junta, agrupada)) return { desde, hasta, conEncabezados: false, ...junta }
  return agrupada ? { desde, hasta, conEncabezados: true, ...agrupada } : null
}

/**
 * Una sola casilla en la pagina y ni asi llega al minimo: la pantalla es
 * diminuta. Se le da todo el espacio con la letra minima.
 */
function paginaDeUna(espacio: Espacio, m: Medidas, desde: number): PaginaDeCuadricula {
  return {
    desde,
    hasta: desde + 1,
    columnas: 1,
    filas: 1,
    altoTarjeta: Math.max(1, Math.floor(espacio.alto)),
    anchoTarjeta: Math.max(1, Math.floor(espacio.ancho)),
    letra: letraConEscala(0, m.lado, m.rango),
    conEncabezados: false,
  }
}

/** Cuantas casillas desde `desde` caben en una pagina, y con que reja. */
function mayorPagina(espacio: Espacio, m: Medidas, claves: string[], desde: number): PaginaDeCuadricula {
  for (let hasta = claves.length; hasta > desde; hasta -= 1) {
    const pagina = paginaCon(espacio, m, { claves, desde, hasta })
    if (pagina) return pagina
  }
  return paginaDeUna(espacio, m, desde)
}

/** Paginar es el ultimo recurso: `mayorPagina` prueba primero todas juntas. */
function paginasDe(util: Espacio, m: Medidas, claves: string[]): PaginaDeCuadricula[] {
  if (claves.length === 0) return [{ ...paginaDeUna(util, m, 0), hasta: 0 }]
  const paginas: PaginaDeCuadricula[] = []
  for (let desde = 0; desde < claves.length; desde = paginas[paginas.length - 1].hasta) {
    paginas.push(mayorPagina(util, m, claves, desde))
  }
  return paginas
}

/** El medico y el consultorio de la pagina, ya con la letra que les deja su texto mas largo (sin topar). */
function conTextos(pagina: PaginaDeCuadricula, m: Medidas, casillas: TextosDeCasilla[]): PaginaDeCuadricula {
  const textos = medirTextos(casillas)
  const banda = (texto: AnchoDeTexto) => ({ texto, ancho: pagina.anchoTarjeta, rellenoEm: RELLENO_BANDA_EM })
  const letra = ajustarATextos(pagina.letra, m.lado, { medico: banda(textos.medico), consultorio: banda(textos.consultorio) })
  return { ...pagina, letra }
}

/**
 * El plan de la cuadricula. `casillas` van en el orden en que se dibujan: las
 * del mismo bloque (servicio), juntas.
 */
/**
 * Los textos tal como se pintan: la banda del consultorio va en MAYUSCULAS
 * (`uppercase`), asi que se mide en mayusculas. Medido tal cual, "Consultorio
 * 12" salia hasta un 10 % mas angosto de lo que ocupa en la tarjeta y el
 * nombre no cabia donde el plan decia.
 */
function comoSePintan(casillas: CasillaDeCuadricula[]): CasillaDeCuadricula[] {
  return casillas.map((casilla) => ({ ...casilla, moduloNombre: casilla.moduloNombre.toLocaleUpperCase('es') }))
}

export function planDeCuadricula(espacio: Espacio, entrada: CasillaDeCuadricula[], pantalla: Espacio): PlanDeCuadricula {
  const casillas = comoSePintan(entrada)
  const normal = medidasDe(pantalla, casillas)
  const claves = casillas.map((c) => c.grupo)
  // Hasta `MAXIMO_EN_UNA_PANTALLA` casillas, todas a la vista: si con la letra
  // normal no caben, se aprieta un poco antes que pasar a una pagina 2.
  const rangos = claves.length <= MAXIMO_EN_UNA_PANTALLA ? rangosEnUnaPantalla(RANGO_CUADRICULA) : [RANGO_CUADRICULA]
  let m = normal
  let paginas = paginasDe(espacioUtil(espacio), m, claves)
  for (const rango of rangos.slice(1)) {
    if (paginas.length <= 1) break
    m = { ...normal, rango }
    paginas = paginasDe(espacioUtil(espacio), m, claves)
  }
  return {
    separacion: m.separacion,
    altoEncabezado: m.altoEncabezado,
    paginas: paginas.map((pagina) => conTextos(pagina, m, casillas)),
  }
}

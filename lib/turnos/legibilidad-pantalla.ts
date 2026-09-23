/**
 * Cuanto tiene que medir la letra del televisor para leerse desde el fondo de
 * la sala.
 *
 * Regla de señaletica: unos 2,5 cm de alto de letra por cada 3 m de distancia.
 * Como no se sabe de que tamaño es el televisor, la letra se expresa como
 * fraccion de la PANTALLA y no en pixeles fijos: el mismo porcentaje se ve
 * igual de grande en un 720p que en un 4K del mismo tamaño fisico. Antes las
 * filas se topaban en pixeles y en 4K el turno quedaba diminuto.
 *
 * La fraccion es del LADO CORTO. En horizontal es el alto; en un televisor
 * puesto en vertical, el ancho: medido contra el alto, el minimo pediria un
 * codigo mas ancho que la pantalla.
 *
 * Todo puro, para poder probarlo con muchas resoluciones.
 */
import { MARCA_DE_NUMERO } from './nombre-consultorio'

export interface Espacio {
  ancho: number
  alto: number
}

/** Tamaños de letra en pixeles. Jerarquia: turno > consultorio > medico > servicio. */
export interface Letra {
  turno: number
  consultorio: number
  medico: number
  servicio: number
}

/** De la letra minima (0) a la maxima (1) de cada elemento, en fraccion del lado corto. */
export interface RangoDeLetra {
  turno: readonly [number, number]
  texto: readonly [number, number]
  /**
   * Con mas de 1, el turno crece mas despacio que el texto al principio del
   * rango y mas deprisa al final: en tarjetas medianas el espacio va primero a
   * que el medico y el consultorio se lean, y el turno "de cartel" queda para
   * cuando sobra sitio. Sin ella, 1 (los dos crecen a la par).
   */
  curvaTurno?: number
}

/** Por debajo de esto no se lee desde el fondo: se reparte en columnas o paginas. */
export const MINIMO_TURNO = 0.045
export const MINIMO_TEXTO = 0.028

/**
 * El servicio es texto de apoyo (la cabecera ya dice el servicio): puede ir
 * mas pequeño, pero nunca por debajo de esto.
 */
const MINIMO_SERVICIO = 0.016

/**
 * El medico va apenas por debajo del consultorio: a donde ir pesa mas que con
 * quien. La diferencia la marcan sobre todo el peso y la pastilla del
 * consultorio; en tamaño, lo justo para no restarle legibilidad al medico.
 */
const MEDICO_SOBRE_CONSULTORIO = 0.95
const SERVICIO_SOBRE_MEDICO = 0.62

/** Si todavia no se pudo medir la ventana: la de un 1080p. */
const PANTALLA_POR_DEFECTO: Espacio = { ancho: 1920, alto: 1080 }
const ESPACIO_POR_DEFECTO: Espacio = { ancho: 1872, alto: 900 }

export function espacioUtil(espacio: Espacio): Espacio {
  return espacio.ancho > 0 && espacio.alto > 0 ? espacio : ESPACIO_POR_DEFECTO
}

export function ladoCorto(pantalla: Espacio): number {
  const util = pantalla.ancho > 0 && pantalla.alto > 0 ? pantalla : PANTALLA_POR_DEFECTO
  return Math.min(util.ancho, util.alto)
}

function interpolar([desde, hasta]: readonly [number, number], escala: number): number {
  return desde + (hasta - desde) * escala
}

/** La letra de cada elemento en un punto `escala` (0 a 1) de su rango. */
export function letraConEscala(escala: number, lado: number, rango: RangoDeLetra): Letra {
  const consultorio = interpolar(rango.texto, escala) * lado
  const medico = Math.max(rango.texto[0] * lado, consultorio * MEDICO_SOBRE_CONSULTORIO)
  return {
    turno: interpolar(rango.turno, escala ** (rango.curvaTurno ?? 1)) * lado,
    consultorio,
    medico,
    servicio: Math.max(MINIMO_SERVICIO * lado, medico * SERVICIO_SOBRE_MEDICO),
  }
}

/** Lo que se escribe en cada casilla: de su largo depende cuanto puede crecer la letra. */
export interface TextosDeCasilla {
  codigo?: string | null
  profesionalNombre?: string | null
  moduloNombre: string
}

/**
 * Ancho de cada caracter, en em, medido sobre los archivos de Geist (la letra
 * del sistema) en negrita y redondeado hacia arriba: mejor sobrar un poco que
 * partir un codigo en dos. Van por clases y no con un ancho unico porque la
 * diferencia es grande: una M mide el triple que una I, y con un promedio los
 * nombres con muchas M ("RAMON", "MARIA") se subestimaban y se cortaban.
 * Las cifras, todas iguales: la pantalla las pinta con `tabular-nums`.
 */
const ANCHOS_EM: ReadonlyArray<readonly [RegExp, number]> = [
  [/[MWmw]/, 1.04],
  [/[ACDGHNOQVÁÓÑ]/, 0.8],
  [/[BKRSUPXÚ]/, 0.73],
  [/[EFJLTYZÉ]/, 0.65],
  [/[IÍijlí]/, 0.34],
  [/[frt]/, 0.48],
  [/\p{Ll}/u, 0.65],
  [/\p{L}/u, 0.8],
  [/\d/, 0.71],
  [/[ .,]/, 0.27],
  [/-/, 0.44],
]
const ANCHO_OTRO_SIGNO_EM = 0.56

function anchoDeCaracter(caracter: string): number {
  return ANCHOS_EM.find(([clase]) => clase.test(caracter))?.[1] ?? ANCHO_OTRO_SIGNO_EM
}

/** Ancho de un texto en una linea, en em. */
export function anchoEnEm(texto: string): number {
  let ancho = 0
  for (const caracter of texto) ancho += anchoDeCaracter(caracter)
  return ancho
}

/** Lo que ocupa un texto en una linea y, partido por la mejor palabra, en dos. En em. */
export interface AnchoDeTexto {
  unaLinea: number
  dosLineas: number
}

function anchoDeTexto(texto: string): AnchoDeTexto {
  const palabras = texto.trim().split(/\s+/)
  let dosLineas = anchoEnEm(texto.trim())
  for (let corte = 1; corte < palabras.length; corte += 1) {
    const arriba = anchoEnEm(palabras.slice(0, corte).join(' '))
    const abajo = anchoEnEm(palabras.slice(corte).join(' '))
    dosLineas = Math.min(dosLineas, Math.max(arriba, abajo))
  }
  return { unaLinea: anchoEnEm(texto.trim()), dosLineas }
}

const masAncho = (a: AnchoDeTexto, b: AnchoDeTexto): AnchoDeTexto => ({
  unaLinea: Math.max(a.unaLinea, b.unaLinea),
  dosLineas: Math.max(a.dosLineas, b.dosLineas),
})

/** El codigo mas largo, el medico mas largo y el consultorio mas largo de la pantalla. */
export interface MedidaDeTextos {
  turno: number
  medico: AnchoDeTexto
  consultorio: AnchoDeTexto
}

/** Si aun no hay ningun turno llamado: el ancho de un codigo corriente ("C-010"). */
const CODIGO_DE_REFERENCIA = 'C-000'

/**
 * El codigo se mide por su FORMA, no por sus letras: cada letra como la mas
 * ancha y cada cifra como un 0 (van en cifras de ancho fijo). Si se midiera tal
 * cual, pasar de "C-011" a "M-010" durante el dia podia cambiar la forma de las
 * filas y la letra de toda la pantalla, sin que nada importante cambiara.
 */
function formaDelCodigo(codigo: string): string {
  return codigo.replace(/\p{L}/gu, 'W').replace(/\d/g, '0')
}
const SIN_TEXTO: AnchoDeTexto = { unaLinea: 0, dosLineas: 0 }

export function medirTextos(casillas: TextosDeCasilla[]): MedidaDeTextos {
  return casillas.reduce<MedidaDeTextos>(
    (medida, casilla) => ({
      turno: Math.max(medida.turno, anchoEnEm(formaDelCodigo(casilla.codigo ?? ''))),
      medico: masAncho(medida.medico, anchoDeTexto(casilla.profesionalNombre ?? '')),
      // Solo el lugar: el numero del consultorio va en su cajita, con un
      // hueco fijo que reserva la pastilla (ver `ADORNO_PASTILLA_EM`).
      consultorio: masAncho(medida.consultorio, anchoDeTexto(casilla.moduloNombre.split(MARCA_DE_NUMERO)[0])),
    }),
    { turno: anchoEnEm(formaDelCodigo(CODIGO_DE_REFERENCIA)), medico: SIN_TEXTO, consultorio: SIN_TEXTO },
  )
}

/**
 * Hasta este ancho en dos lineas (un nombre como "CARLOS RAMON DE LEON
 * CASTILLO") el plan reserva sitio para que quepa sin achicar la letra. Uno
 * mas largo no le quita tamaño al turno: solo se achica el suyo
 * (`ajustarATextos`).
 */
const DOS_LINEAS_SIN_ACHICAR_EM = 11

/**
 * El hueco del medico no depende de quien este llamando: se reserva siempre
 * el de un nombre largo en DOS lineas, a lo ancho y a lo alto. Los medicos
 * cambian en cada llamado y, si el hueco se midiera con sus nombres, la letra
 * de TODA la pantalla daria un salto cada vez que llamara uno de nombre mas
 * largo. Y el alto de la segunda linea va siempre: antes, en una celda ancha
 * se suponia una sola, y un nombre real ("DRA. MARIA CAMILA RODRIGUEZ
 * MONTERROSA") se partia igual y recortaba la fila. Los consultorios, en
 * cambio, son fijos (los nombra el administrador) y si se miden.
 */
const MEDICO_RESERVADO: AnchoDeTexto = { unaLinea: Number.POSITIVE_INFINITY, dosLineas: DOS_LINEAS_SIN_ACHICAR_EM }

/** Lo que el plan se compromete a mostrar sin achicar. */
export function textosReservados(medida: MedidaDeTextos): MedidaDeTextos {
  const topar = (texto: AnchoDeTexto) => ({ ...texto, dosLineas: Math.min(texto.dosLineas, DOS_LINEAS_SIN_ACHICAR_EM) })
  return { ...medida, medico: MEDICO_RESERVADO, consultorio: topar(medida.consultorio) }
}

/** El medico y el consultorio pasan a DOS lineas antes de achicar la letra; a tres, nunca. */
export function lineasQueOcupa(texto: AnchoDeTexto, anchoEm: number): 1 | 2 {
  return texto.unaLinea <= anchoEm ? 1 : 2
}

/** La letra con la que el texto cabe en dos lineas de `ancho`, con `rellenoEm` de adorno. */
function letraQueCabe(texto: AnchoDeTexto, ancho: number, rellenoEm: number): number {
  return ancho / (texto.dosLineas + rellenoEm)
}

interface Celda {
  texto: AnchoDeTexto
  ancho: number
  rellenoEm: number
}

/**
 * Achica SOLO el texto que no cabe en dos lineas (un nombre muy largo), sin
 * tocar el turno y sin bajar del minimo legible. Si ni con el minimo cabe, el
 * resto se corta con puntos suspensivos: es mejor que letra ilegible.
 */
/** Cuanto mas se puede achicar un nombre largo cuando la pantalla ya va apretada. */
const PISO_SI_APRETADA = 0.8

export function ajustarATextos(letra: Letra, lado: number, celdas: { medico: Celda; consultorio: Celda }): Letra {
  // El piso es el minimo legible. Si la pantalla ya esta apretada para que
  // quepan todos (ver `rangosEnUnaPantalla`), el piso baja con ella: un nombre
  // largo se achica un poco mas antes que cortarse con puntos suspensivos, que
  // es justo lo que no deja leer quien atiende.
  const piso = (actual: number) => (actual < MINIMO_TEXTO * lado ? actual * PISO_SI_APRETADA : MINIMO_TEXTO * lado)
  const ajustar = (actual: number, celda: Celda) =>
    Math.max(piso(actual), Math.min(actual, letraQueCabe(celda.texto, celda.ancho, celda.rellenoEm)))
  const medico = ajustar(letra.medico, celdas.medico)
  return {
    ...letra,
    medico,
    consultorio: ajustar(letra.consultorio, celdas.consultorio),
    servicio: Math.max(MINIMO_SERVICIO * lado, medico * SERVICIO_SOBRE_MEDICO),
  }
}

/**
 * Hasta cuantos turnos se ven SIEMPRE en una sola pantalla, sin paginas.
 *
 * Es un solo televisor en la sala de espera: una pagina 2 que rota cada diez
 * segundos es un paciente que no ve su turno cuando mira. El hospital trabaja
 * con unos 10 consultorios y hasta 12; se deja margen hasta 15.
 */
export const MAXIMO_EN_UNA_PANTALLA = 15

/**
 * Los rangos que se prueban, en orden, para que quepan todos en una pantalla:
 * primero el normal (letra grande) y, solo si no caben, rangos un poco mas
 * apretados. Se toma el primero con el que caben todos.
 */
export function rangosEnUnaPantalla(normal: RangoDeLetra): RangoDeLetra[] {
  const apretar = (factor: number): RangoDeLetra => ({
    ...normal,
    turno: [normal.turno[0] * factor, normal.turno[1]],
    texto: [normal.texto[0] * factor, normal.texto[1]],
  })
  return [normal, apretar(0.85), apretar(0.7), apretar(0.55)]
}

/** Pasos de la busqueda binaria: con 14, la escala se afina a menos de 0,01 %. */
const PASOS_DE_BUSQUEDA = 14

/**
 * La letra mas grande del rango con la que `cabe` todavia dice que si, o null
 * si ni con la minima cabe. Crecer siempre ocupa mas, asi que basta una
 * busqueda binaria.
 */
export function mayorLetra(opciones: { lado: number; rango: RangoDeLetra; cabe: (letra: Letra) => boolean }): Letra | null {
  const { lado, rango, cabe } = opciones
  const con = (escala: number) => letraConEscala(escala, lado, rango)
  if (!cabe(con(0))) return null
  if (cabe(con(1))) return con(1)
  let [cabeSeguro, noCabe] = [0, 1]
  for (let paso = 0; paso < PASOS_DE_BUSQUEDA; paso += 1) {
    const medio = (cabeSeguro + noCabe) / 2
    if (cabe(con(medio))) cabeSeguro = medio
    else noCabe = medio
  }
  return con(cabeSeguro)
}

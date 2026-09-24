/**
 * Lectura del "Reporte de citas asignadas" que el hospital exporta cada dia.
 *
 * QUE ES ESTE ARCHIVO. El sistema de historia clinica del hospital
 * (SaludPlus) exporta la agenda del dia desde su servidor de informes. Sale en
 * dos formatos, y los dos entran aqui:
 *
 *   - XML: el que el servidor de informes llama "XML". Es una sola etiqueta
 *     `<Detalles .../>` por cita, con todo en atributos. Es el formato limpio,
 *     el que conviene pedir.
 *   - XLSX: la misma tabla exportada a Excel. Trae dos filas de titulo antes
 *     del encabezado, asi que el encabezado se BUSCA en vez de darse por hecho
 *     que esta en la primera fila.
 *
 * TODO LO DE AQUI ES PURO: recibe los bytes del archivo y devuelve filas y
 * errores. No toca la base de datos ni la sesion. Esa separacion es lo que
 * permite probar la parte dificil —interpretar lo que manda el hospital— sin
 * levantar nada, y es donde de verdad se rompen estas cargas: una fecha en otro
 * formato, un doctor con dos espacios en el nombre, una fila vacia al final.
 *
 * QUE SE GUARDA Y QUE NO. El reporte trae edad, sexo, telefono, EPS, contrato,
 * observaciones y quien creo la cita en su sistema. NADA DE ESO ENTRA: el
 * requerimiento (seccion 17) dice que no se almacenen datos del paciente que no
 * hagan falta para operar el turno. Se toma lo justo para poder buscar al
 * paciente en admisiones y ponerlo en la fila del doctor correcto: documento,
 * nombre, hora, profesional, consultorio y procedimiento.
 */
import { esFechaValida, instanteDeFranja } from '@/lib/turnos/tiempo'

/** Una cita del reporte, ya interpretada. */
export interface FilaReporte {
  /** Numero de fila del archivo, para poder señalarla en el informe de carga. */
  fila: number
  /** Dia AAAA-MM-DD en hora de Colombia. */
  fecha: string
  /** Instante de la cita, ISO 8601. */
  horaCita: string
  tipoDocumento: string | null
  documentoPaciente: string
  nombrePaciente: string
  cups: string | null
  procedimiento: string | null
  profesional: Referencia
  /** Puede faltar: hay filas sin consultorio asignado. */
  consultorio: Referencia | null
  servicio: ServicioDerivado
}

/**
 * Algo del catalogo tal como viene del hospital.
 *
 * `clave` es con lo que se empareja carga tras carga y NO se muestra; `nombre`
 * es lo que se ve y el administrador puede cambiar. Separarlos es lo que
 * permite renombrar "CONS 01- CONSULTA EXTERNA" a "Consultorio 1" sin que la
 * carga del dia siguiente lo tome por un consultorio nuevo y lo duplique.
 */
export interface Referencia {
  clave: string
  nombre: string
}

export interface ServicioDerivado {
  /**
   * Con lo que la carga reconoce este servicio carga tras carga
   * (`Servicio.claveExterna`). Es FIJA, como la de consultorios y doctores:
   * el administrador puede renombrar el servicio sin que la carga siguiente
   * deje de encontrarlo o lo duplique.
   */
  clave: string
  nombre: string
  prefijo: string
}

/** Una fila que no se pudo usar, con el motivo en el idioma del funcionario. */
export interface ErrorFila {
  fila: number
  motivo: string
}

export interface ReporteLeido {
  filas: FilaReporte[]
  errores: ErrorFila[]
  /** Dias distintos que trae el archivo. Normalmente uno. */
  fechas: string[]
}

// ---------------------------------------------------------------------------
// Los dos servicios del hospital
// ---------------------------------------------------------------------------

/**
 * A que servicio pertenece una cita.
 *
 * El hospital tiene DOS filas, no una por especialidad: odontologia va aparte
 * porque tiene sus propios consultorios y su propio volumen, y todo lo demas
 * (medicina general, P y M, psicologia, pediatria...) cuelga de consulta
 * externa. Al paciente no se le pone la especialidad en la pantalla: ya sabe a
 * que viene, y leer "P y M" en el televisor solo lo obliga a interpretar algo
 * que no tiene por que saber.
 *
 * Se mira el procedimiento primero, que es el dato que de verdad dice que se le
 * hace al paciente, y el consultorio como respaldo cuando el procedimiento
 * viene vacio.
 */
export const SERVICIO_ODONTOLOGIA: ServicioDerivado = { clave: 'ODONTOLOGIA', nombre: 'Odontologia', prefijo: 'O' }
export const SERVICIO_CONSULTA_EXTERNA: ServicioDerivado = {
  clave: 'CONSULTA EXTERNA',
  nombre: 'Consulta externa',
  prefijo: 'C',
}

export function servicioDeLaCita(procedimiento: string, consultorio: string): ServicioDerivado {
  const texto = sinTildes(`${procedimiento} ${consultorio}`).toUpperCase()
  return texto.includes('ODONTOLOG') ? SERVICIO_ODONTOLOGIA : SERVICIO_CONSULTA_EXTERNA
}

// ---------------------------------------------------------------------------
// Normalizacion
// ---------------------------------------------------------------------------

/** Quita tildes. Se compara sin ellas porque el reporte no es consistente. */
function sinTildes(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Espacios de sobra fuera.
 *
 * No es cosmetico: en el reporte real hay doctores escritos como
 * `"YENNY  CORTES "` —dos espacios y uno al final— y sin esto cada variacion de
 * espaciado crearia un doctor distinto en el catalogo, con su propia fila de
 * pacientes que nadie llamaria.
 */
export function normalizarEspacios(texto: string) {
  return texto.replace(/\s+/g, ' ').trim()
}

/** La clave con la que se empareja algo del catalogo entre una carga y otra. */
export function claveDe(texto: string) {
  return sinTildes(normalizarEspacios(texto)).toUpperCase()
}

/**
 * Fecha del reporte a dia AAAA-MM-DD, o `null` si no se reconoce o no existe.
 *
 * Llega como DD/MM/AAAA (formato colombiano) en el XML, y como celda de fecha
 * en el XLSX, que Excel entrega ya convertida. Se aceptan los dos, y tambien
 * AAAA-MM-DD por si algun dia cambian el formato del informe.
 *
 * SE COMPRUEBA QUE EL DIA EXISTA. Armar la cadena no basta: "32/09/2026" o
 * "09/14/2026" (el mes primero) daban un dia imposible que reventaba al
 * calcular el instante de la cita, y con el la carga entera; "31/02/2026" ni
 * siquiera reventaba, y la cita quedaba guardada en un dia que no existe.
 */
export function normalizarFecha(valor: unknown): string | null {
  const candidata = fechaConForma(valor)
  return candidata && esFechaValida(candidata) ? candidata : null
}

/** La fecha escrita como AAAA-MM-DD, exista ese dia o no. */
function fechaConForma(valor: unknown): string | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    // Excel entrega las fechas como medianoche UTC del dia que muestra la
    // celda. Se toma esa fecha tal cual y NO se convierte a Colombia: hacerlo
    // la correria al dia anterior.
    return valor.toISOString().slice(0, 10)
  }

  const texto = String(valor ?? '').trim()
  const conBarras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto)
  if (conBarras) {
    const [, dia, mes, ano] = conBarras
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto)
  return iso ? iso[0].slice(0, 10) : null
}

/** Hora del reporte a "HH:MM". Acepta "07:00", "7:00" y "07:00:00". */
export function normalizarHora(valor: unknown): string | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const h = String(valor.getUTCHours()).padStart(2, '0')
    const m = String(valor.getUTCMinutes()).padStart(2, '0')
    return `${h}:${m}`
  }

  const texto = String(valor ?? '').trim()
  const partes = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(texto)
  if (!partes) return null

  const horas = Number(partes[1])
  const minutos = Number(partes[2])
  if (horas > 23 || minutos > 59) return null

  return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Interpretacion de una fila, comun a los dos formatos
// ---------------------------------------------------------------------------

/** Los campos que se usan, con el nombre que tienen en el reporte. */
export interface CamposCrudos {
  fecha: unknown
  hora: unknown
  tipoDocumento: unknown
  documento: unknown
  nombrePaciente: unknown
  cups: unknown
  procedimiento: unknown
  consultorio: unknown
  profesional: unknown
}

const texto = (valor: unknown) => normalizarEspacios(String(valor ?? ''))

/**
 * Por que no sirve la fecha de una fila.
 *
 * Se distingue la que no parece una fecha de la que tiene forma de fecha pero
 * no existe: a esta ultima casi siempre le pasa que viene con el mes primero,
 * y decirlo es lo que le ahorra al funcionario adivinar que corregir.
 */
function motivoDeFecha(valor: unknown) {
  if (!fechaConForma(valor)) return `Fecha no reconocida: "${texto(valor)}".`
  return `La fecha "${texto(valor)}" no existe en el calendario. El reporte debe traerla como dia/mes/año (DD/MM/AAAA).`
}

/**
 * Convierte una fila cruda en una cita, o dice por que no se puede.
 *
 * Devuelve el motivo en vez de lanzar: una fila mala no puede tumbar la carga
 * entera. Con 300 citas al dia, que un dato raro en la fila 180 dejara sin
 * agenda a todo el hospital seria mucho peor que perder esa fila y avisarlo.
 */
export function interpretarFila(fila: number, crudo: CamposCrudos): FilaReporte | ErrorFila {
  const fecha = normalizarFecha(crudo.fecha)
  if (!fecha) return { fila, motivo: motivoDeFecha(crudo.fecha) }

  const hora = normalizarHora(crudo.hora)
  if (!hora) return { fila, motivo: `Hora no reconocida: "${texto(crudo.hora)}".` }

  // Solo digitos: el reporte a veces trae el documento con puntos o espacios, y
  // admisiones busca escribiendo el numero pelado. Si no coinciden caracter a
  // caracter, el paciente esta en el sistema y aun asi "no aparece".
  const documento = texto(crudo.documento).replace(/[^0-9A-Za-z]/g, '')
  if (!documento) return { fila, motivo: 'La fila no trae documento del paciente.' }

  const nombrePaciente = texto(crudo.nombrePaciente)
  if (!nombrePaciente) return { fila, motivo: `El documento ${documento} viene sin nombre.` }

  const nombreProfesional = texto(crudo.profesional)
  if (!nombreProfesional) {
    return { fila, motivo: `La cita de ${documento} no dice que profesional la atiende.` }
  }

  const nombreConsultorio = texto(crudo.consultorio)
  const procedimiento = texto(crudo.procedimiento)

  return {
    fila,
    fecha,
    // En hora de Colombia, con el desfase escrito a mano: es la misma regla
    // que usa toda la agenda.
    horaCita: instanteDeFranja(fecha, hora),
    tipoDocumento: texto(crudo.tipoDocumento) || null,
    documentoPaciente: documento,
    nombrePaciente,
    cups: texto(crudo.cups) || null,
    procedimiento: procedimiento || null,
    profesional: { clave: claveDe(nombreProfesional), nombre: nombreProfesional },
    consultorio: nombreConsultorio
      ? { clave: claveDe(nombreConsultorio), nombre: nombreConsultorio }
      : null,
    servicio: servicioDeLaCita(procedimiento, nombreConsultorio),
  }
}

function esError(valor: FilaReporte | ErrorFila): valor is ErrorFila {
  return 'motivo' in valor
}

function reunir(interpretadas: Array<FilaReporte | ErrorFila>): ReporteLeido {
  const filas: FilaReporte[] = []
  const errores: ErrorFila[] = []

  for (const item of interpretadas) {
    if (esError(item)) errores.push(item)
    else filas.push(item)
  }

  return { filas, errores, fechas: [...new Set(filas.map((f) => f.fecha))].sort() }
}

// ---------------------------------------------------------------------------
// Formato XML (el que exporta el servidor de informes)
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
}

function desescapar(valor: string) {
  return valor.replace(/&(#\d+|#x[0-9a-fA-F]+|\w+);/g, (todo, nombre: string) => {
    if (nombre.startsWith('#x')) return String.fromCodePoint(parseInt(nombre.slice(2), 16))
    if (nombre.startsWith('#') && nombre !== '#39') return String.fromCodePoint(Number(nombre.slice(1)))
    return ENTIDADES[nombre] ?? todo
  })
}

/**
 * Atributos de una etiqueta `<Detalles ... />`.
 *
 * Se lee con expresiones regulares y no con un analizador de XML completo
 * porque este archivo no es XML cualquiera: lo genera siempre el mismo informe,
 * es plano (una etiqueta por cita, todo en atributos, sin contenido anidado) y
 * no trae ni CDATA ni comentarios. Meter una dependencia de analisis de XML
 * para esto seria mas superficie que ventaja. Si algun dia el informe cambia de
 * forma, lo que falla es la deteccion de filas, no un dato mal leido en
 * silencio: si no encuentra ninguna etiqueta, se avisa.
 */
function atributosDe(etiqueta: string): Record<string, string> {
  const atributos: Record<string, string> = {}
  for (const [, nombre, valor] of etiqueta.matchAll(/([\w.:]+)\s*=\s*"([^"]*)"/g)) {
    atributos[nombre] = desescapar(valor)
  }
  return atributos
}

export function leerReporteXml(contenido: string): ReporteLeido {
  const etiquetas = [...contenido.matchAll(/<Detalles\b([^>]*?)\/?>/g)].map((m) => m[1])

  if (etiquetas.length === 0) {
    return {
      filas: [],
      errores: [
        {
          fila: 0,
          motivo:
            'El archivo XML no contiene citas (no se encontro ninguna etiqueta <Detalles>). Verifica que sea el Reporte de citas asignadas y no otro informe.',
        },
      ],
      fechas: [],
    }
  }

  return reunir(
    etiquetas.map((etiqueta, indice) => {
      const a = atributosDe(etiqueta)
      return interpretarFila(indice + 1, {
        fecha: a.fecha_inicio,
        hora: a.hora_inicio,
        tipoDocumento: a.tipo_documento,
        documento: a.numero_documento1,
        nombrePaciente: a.nombre_paciente,
        // "cusp" es como lo escribe el informe; el codigo se llama CUPS.
        cups: a.cusp ?? a.cups,
        procedimiento: a.NombreProcedimiento,
        consultorio: a.descripcion_consultorio,
        profesional: a.nombre_profesional,
      })
    }),
  )
}

// ---------------------------------------------------------------------------
// Formato XLSX
// ---------------------------------------------------------------------------

/**
 * Como se llama cada columna en el encabezado del Excel.
 *
 * Se compara sin tildes, sin mayusculas y sin puntos, porque el encabezado del
 * informe no es estable en eso ("Nombre proc." / "NOMBRE PROC").
 */
const COLUMNAS: Record<keyof CamposCrudos, string[]> = {
  fecha: ['fecha'],
  hora: ['hora'],
  tipoDocumento: ['tipo', 'tipo doc', 'tipo documento'],
  documento: ['documento', 'numero documento', 'no documento'],
  nombrePaciente: ['nombre paciente', 'paciente'],
  cups: ['cups', 'cusp'],
  procedimiento: ['nombre proc', 'procedimiento', 'nombre procedimiento'],
  consultorio: ['consultorio', 'descripcion consultorio'],
  profesional: ['nombre prof', 'profesional', 'nombre profesional'],
}

function encabezadoNormalizado(valor: unknown) {
  return sinTildes(String(valor ?? ''))
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * En que columna esta cada campo.
 *
 * Se resuelve por NOMBRE y no por posicion porque el informe se exporta con las
 * columnas que el funcionario deje marcadas: fijar "el documento es la columna
 * E" convierte un cambio inocente en el informe en pacientes cargados con el
 * nombre en el campo del documento.
 */
function mapearColumnas(encabezado: unknown[]): Partial<Record<keyof CamposCrudos, number>> {
  const posiciones: Partial<Record<keyof CamposCrudos, number>> = {}

  encabezado.forEach((celda, indice) => {
    const nombre = encabezadoNormalizado(celda)
    if (!nombre) return

    for (const [campo, alias] of Object.entries(COLUMNAS) as Array<[keyof CamposCrudos, string[]]>) {
      // El primero que aparezca se queda con el campo: en el reporte hay dos
      // columnas que empiezan por "Fecha" (la de la cita y la de creacion), y
      // la que importa es la primera.
      if (posiciones[campo] === undefined && alias.includes(nombre)) posiciones[campo] = indice
    }
  })

  return posiciones
}

/** Campos sin los cuales la carga no tiene sentido. */
const OBLIGATORIAS: Array<[keyof CamposCrudos, string]> = [
  ['fecha', 'Fecha'],
  ['hora', 'Hora'],
  ['documento', 'Documento'],
  ['nombrePaciente', 'Nombre Paciente'],
  ['profesional', 'Nombre prof.'],
]

/**
 * Lee la hoja ya convertida a una matriz de celdas.
 *
 * Recibe la matriz y no el archivo para que esta parte —que es donde estan las
 * decisiones: donde empieza el encabezado, que columna es cual— se pueda probar
 * sin generar un Excel.
 */
export function leerReporteEnFilas(matriz: unknown[][]): ReporteLeido {
  // El encabezado NO esta en la primera fila: el informe pone antes el titulo y
  // el rango de fechas. Se busca la primera fila que tenga a la vez columna de
  // documento y de paciente, que es la unica combinacion que identifica al
  // encabezado de verdad.
  const indiceEncabezado = matriz.findIndex((fila) => {
    const posiciones = mapearColumnas(fila ?? [])
    return posiciones.documento !== undefined && posiciones.nombrePaciente !== undefined
  })

  if (indiceEncabezado < 0) {
    return {
      filas: [],
      errores: [
        {
          fila: 0,
          motivo:
            'No se encontro el encabezado del reporte. Debe traer al menos las columnas Documento y Nombre Paciente.',
        },
      ],
      fechas: [],
    }
  }

  const posiciones = mapearColumnas(matriz[indiceEncabezado])
  const faltan = OBLIGATORIAS.filter(([campo]) => posiciones[campo] === undefined).map(([, etiqueta]) => etiqueta)
  if (faltan.length > 0) {
    return {
      filas: [],
      errores: [{ fila: indiceEncabezado + 1, motivo: `Al reporte le faltan columnas: ${faltan.join(', ')}.` }],
      fechas: [],
    }
  }

  const celda = (fila: unknown[], campo: keyof CamposCrudos) => {
    const indice = posiciones[campo]
    return indice === undefined ? '' : fila[indice]
  }

  const interpretadas: Array<FilaReporte | ErrorFila> = []

  for (let i = indiceEncabezado + 1; i < matriz.length; i += 1) {
    const fila = matriz[i] ?? []

    // Las filas en blanco del final del informe no son un error: se saltan sin
    // contarlas, porque llenar el informe de carga con "fila 301 vacia" esconde
    // los rechazos que si hay que mirar.
    if (fila.every((valor) => String(valor ?? '').trim() === '')) continue

    interpretadas.push(
      interpretarFila(i + 1, {
        fecha: celda(fila, 'fecha'),
        hora: celda(fila, 'hora'),
        tipoDocumento: celda(fila, 'tipoDocumento'),
        documento: celda(fila, 'documento'),
        nombrePaciente: celda(fila, 'nombrePaciente'),
        cups: celda(fila, 'cups'),
        procedimiento: celda(fila, 'procedimiento'),
        consultorio: celda(fila, 'consultorio'),
        profesional: celda(fila, 'profesional'),
      }),
    )
  }

  return reunir(interpretadas)
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

/** Si los bytes son un Excel binario antiguo (.xls de verdad, no XML). */
function esExcelBinario(datos: Uint8Array) {
  // Documento compuesto OLE2: la firma con la que empiezan los .xls de Excel 97.
  const firma = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return firma.every((byte, i) => datos[i] === byte)
}

/** Si los bytes son un ZIP, que es lo que de verdad es un .xlsx. */
function esZip(datos: Uint8Array) {
  return datos[0] === 0x50 && datos[1] === 0x4b
}

/**
 * Lee el reporte del hospital, sea cual sea de los dos formatos.
 *
 * SE MIRA EL CONTENIDO, NO LA EXTENSION. El servidor de informes exporta un
 * archivo llamado `.xls` que por dentro es XML, y ese es justo el caso que hay
 * que acertar: fiarse del nombre haria fallar la carga del archivo que el
 * hospital de verdad usa.
 */
export async function leerReporteDelHospital(datos: Uint8Array): Promise<ReporteLeido> {
  if (esZip(datos)) return leerXlsx(datos)

  if (esExcelBinario(datos)) {
    return {
      filas: [],
      errores: [
        {
          fila: 0,
          motivo:
            'El archivo es un Excel antiguo (.xls binario), que este sistema no lee. Vuelve a exportar el Reporte de citas asignadas como XML, o abrelo en Excel y guardalo como .xlsx.',
        },
      ],
      fechas: [],
    }
  }

  // El resto se trata como texto: el XML del servidor de informes.
  const contenido = new TextDecoder('utf-8').decode(datos).replace(/^\uFEFF/, '')
  return leerReporteXml(contenido)
}

/**
 * Convierte la primera hoja del .xlsx en una matriz y la interpreta.
 *
 * `exceljs` se carga solo aqui, con import dinamico: es una dependencia grande
 * y la mayoria de las cargas son del XML, que no la necesita.
 */
async function leerXlsx(datos: Uint8Array): Promise<ReporteLeido> {
  const ExcelJS = (await import('exceljs')).default
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(Buffer.from(datos) as unknown as ArrayBuffer)

  const hoja = libro.worksheets[0]
  if (!hoja) {
    return { filas: [], errores: [{ fila: 0, motivo: 'El archivo de Excel no tiene ninguna hoja.' }], fechas: [] }
  }

  const matriz: unknown[][] = []
  hoja.eachRow({ includeEmpty: true }, (fila) => {
    // `fila.values` deja la posicion 0 vacia porque las columnas de Excel
    // empiezan en 1.
    const valores = Array.isArray(fila.values) ? fila.values.slice(1) : []
    matriz.push(valores.map(valorDeCelda))
  })

  return leerReporteEnFilas(matriz)
}

/**
 * El valor util de una celda.
 *
 * Excel devuelve objetos para las celdas con formula, con hipervinculo o con
 * texto enriquecido. Sin desenvolverlos, el documento del paciente llegaria
 * como "[object Object]" y la fila se rechazaria sin que nadie entienda por
 * que.
 */
function valorDeCelda(valor: unknown): unknown {
  if (valor === null || valor === undefined) return ''
  if (valor instanceof Date) return valor
  if (typeof valor === 'object') {
    const objeto = valor as { result?: unknown; text?: unknown; richText?: Array<{ text: string }> }
    if (Array.isArray(objeto.richText)) return objeto.richText.map((parte) => parte.text).join('')
    if (objeto.text !== undefined) return objeto.text
    if (objeto.result !== undefined) return objeto.result
    return ''
  }
  return valor
}

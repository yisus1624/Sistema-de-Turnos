// Una base de datos de mentira para ejercitar la carga diaria ENTERA
// (`importarReporteDeCitas`) sin PostgreSQL.
//
// La carga habla con Prisma directamente, no con el repositorio, y por eso no
// tenia ni una prueba de punta a punta: sin una base delante no habia forma de
// pasarle un archivo y mirar que dejaba escrito. Aqui se imitan solo las
// operaciones que usa, con los indices unicos del esquema TAL COMO LOS INFORMA
// PostgreSQL a traves de Prisma 6: `meta.target` trae las columnas del indice
// (o la expresion, en los de nombre normalizado) y `meta.modelName`, nunca el
// nombre del indice. Se comprobo contra PostgreSQL 16. Una prueba que pasara
// contra una base sin esos indices no diria nada de lo que pasa en el hospital.
//
// Hay que importarlo ANTES que la carga: sustituye `lib/prisma.ts` y, para no
// arrastrar el recalculo de jornadas (que tiene sus propias pruebas), tambien
// `lib/citas/jornadas.ts`.
import { mock } from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Prisma } from '@prisma/client'

const RAIZ = path.resolve(import.meta.dirname, '..')
const comoUrl = (relativa) => pathToFileURL(path.join(RAIZ, relativa)).href

/** Las filas guardadas, por tabla. Las pruebas las leen y las tocan a mano. */
export const base = { servicio: [], modulo: [], profesional: [], cita: [], cargaCitas: [] }

export function vaciarBase() {
  for (const filas of Object.values(base)) filas.length = 0
}

const MODELO = {
  servicio: 'Servicio',
  modulo: 'Modulo',
  profesional: 'Profesional',
  cita: 'Cita',
  cargaCitas: 'CargaCitas',
}

const instante = (fecha) => new Date(fecha).toISOString()
const nombreNormalizado = (fila) => fila.nombre.trim().toLowerCase()
const exacta = (columna) => (fila) => fila[columna] ?? null

/**
 * Indices unicos de cada tabla: lo que Prisma pone en `meta.target` y el valor
 * que no se puede repetir. Un valor `null` no choca, igual que en PostgreSQL
 * (NULL no se compara, y el indice parcial no cubre las filas que deja fuera).
 */
const UNICOS = {
  servicio: [
    { target: ['nombre'], valor: exacta('nombre') },
    { target: ['lower(TRIM(BOTH FROM nombre))'], valor: nombreNormalizado },
    { target: ['prefijo'], valor: exacta('prefijo') },
    { target: ['claveExterna'], valor: exacta('claveExterna') },
  ],
  modulo: [
    { target: ['nombre'], valor: exacta('nombre') },
    { target: ['lower(TRIM(BOTH FROM nombre))'], valor: nombreNormalizado },
    { target: ['claveExterna'], valor: exacta('claveExterna') },
  ],
  profesional: [
    { target: ['nombre'], valor: exacta('nombre') },
    { target: ['lower(TRIM(BOTH FROM nombre))'], valor: nombreNormalizado },
    { target: ['claveExterna'], valor: exacta('claveExterna') },
  ],
  cita: [
    {
      target: ['fecha', 'documentoPaciente', 'profesionalId', 'horaCita'],
      valor: (f) => `${f.fecha}|${f.documentoPaciente}|${f.profesionalId}|${instante(f.horaCita)}`,
    },
    {
      // `citas_cupo_manual_unico`: parcial, solo las MANUALES no canceladas.
      target: ['fecha', 'profesionalId', 'horaCita'],
      valor: (f) =>
        f.origen === 'MANUAL' && f.estado !== 'CANCELADA' ? `${f.fecha}|${f.profesionalId}|${instante(f.horaCita)}` : null,
    },
  ],
  cargaCitas: [],
}

function choqueDeUnico(tabla, target) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: Prisma.prismaVersion.client,
    meta: { modelName: MODELO[tabla], target },
  })
}

function exigirUnicos(tabla, fila) {
  for (const indice of UNICOS[tabla]) {
    const valor = indice.valor(fila)
    if (valor === null) continue
    const repetida = base[tabla].some((otra) => otra !== fila && otra.id !== fila.id && indice.valor(otra) === valor)
    if (repetida) throw choqueDeUnico(tabla, indice.target)
  }
}

// --- El `where` de Prisma, en lo que usa la carga ---

const igual = (a, b) =>
  a instanceof Date || b instanceof Date ? a !== null && b !== null && instante(a) === instante(b) : a === b

const OPERADORES = {
  equals: (valor, esperado, condicion) =>
    condicion.mode === 'insensitive' ? String(valor).toLowerCase() === String(esperado).toLowerCase() : igual(valor, esperado),
  in: (valor, lista) => lista.some((x) => igual(valor, x)),
  notIn: (valor, lista) => !lista.some((x) => igual(valor, x)),
  not: (valor, esperado) => !cumpleCampo(valor, esperado),
  gt: (valor, esperado) => valor > esperado,
  gte: (valor, esperado) => valor >= esperado,
  lt: (valor, esperado) => valor < esperado,
  lte: (valor, esperado) => valor <= esperado,
  mode: () => true,
}

function cumpleCampo(valor, condicion) {
  if (condicion === null || typeof condicion !== 'object' || condicion instanceof Date) return igual(valor, condicion)
  return Object.entries(condicion).every(([operador, esperado]) => OPERADORES[operador](valor, esperado, condicion))
}

function cumple(fila, where = {}) {
  return Object.entries(where).every(([campo, condicion]) => {
    if (campo === 'OR') return condicion.some((otro) => cumple(fila, otro))
    if (campo === 'NOT') return !cumple(fila, condicion)
    return cumpleCampo(fila[campo], condicion)
  })
}

// --- Filas nuevas con los valores por defecto del esquema ---

let secuencia = 0

const POR_DEFECTO = {
  servicio: () => ({ modoFila: 'POR_PROFESIONAL', activo: true, claveExterna: null }),
  modulo: () => ({ servicioId: null, activo: true, claveExterna: null }),
  profesional: () => ({ jornada: 'COMPLETA', moduloId: null, usuarioId: null, activo: true, claveExterna: null }),
  cita: () => ({
    tipoDocumento: null,
    estado: 'PROGRAMADA',
    origen: 'MANUAL',
    procedimiento: null,
    cups: null,
    creadaEn: new Date(),
    creadaPor: null,
    horaCitaOriginal: null,
    vecesReprogramada: 0,
    reprogramadaEn: null,
    reprogramadaPor: null,
    motivoReprogramacion: null,
    canceladaEn: null,
    canceladaPor: null,
    motivoCancelacion: null,
    cargaId: null,
  }),
  cargaCitas: () => ({
    subidaEn: new Date(),
    subidaPor: null,
    fecha: null,
    filasLeidas: 0,
    creadas: 0,
    actualizadas: 0,
    omitidas: 0,
    errores: null,
  }),
}

function insertar(tabla, datos) {
  secuencia += 1
  const fila = { id: `${tabla}-${secuencia}`, ...POR_DEFECTO[tabla](), ...datos }
  exigirUnicos(tabla, fila)
  base[tabla].push(fila)
  return { ...fila }
}

function aplicarCambios(tabla, fila, datos) {
  const antes = { ...fila }
  for (const [campo, valor] of Object.entries(datos)) {
    fila[campo] = valor !== null && typeof valor === 'object' && 'increment' in valor ? fila[campo] + valor.increment : valor
  }
  try {
    exigirUnicos(tabla, fila)
  } catch (error) {
    Object.assign(fila, antes)
    throw error
  }
  return { ...fila }
}

function ordenar(filas, orderBy) {
  if (!orderBy) return filas
  const [[campo, sentido]] = Object.entries(orderBy)
  const signo = sentido === 'desc' ? -1 : 1
  return [...filas].sort((a, b) => (a[campo] < b[campo] ? -signo : a[campo] > b[campo] ? signo : 0))
}

function tablaFalsa(tabla) {
  const filtrar = (where) => base[tabla].filter((fila) => cumple(fila, where))
  return {
    async findMany({ where, orderBy } = {}) {
      return ordenar(filtrar(where), orderBy).map((fila) => ({ ...fila }))
    },
    async findFirst({ where, orderBy } = {}) {
      const [primera] = ordenar(filtrar(where), orderBy)
      return primera ? { ...primera } : null
    },
    async findUnique({ where }) {
      const [unica] = filtrar(where)
      return unica ? { ...unica } : null
    },
    async count({ where } = {}) {
      return filtrar(where).length
    },
    async create({ data }) {
      return insertar(tabla, data)
    },
    async createMany({ data, skipDuplicates }) {
      let count = 0
      for (const datos of data) {
        try {
          insertar(tabla, datos)
          count += 1
        } catch (error) {
          if (!skipDuplicates || error.code !== 'P2002') throw error
        }
      }
      return { count }
    },
    async update({ where, data }) {
      const [fila] = filtrar(where)
      if (!fila) throw new Error(`${MODELO[tabla]} no encontrado`)
      return aplicarCambios(tabla, fila, data)
    },
    async updateMany({ where, data }) {
      const filas = filtrar(where)
      for (const fila of filas) aplicarCambios(tabla, fila, data)
      return { count: filas.length }
    },
  }
}

const prismaFalso = {
  servicio: tablaFalsa('servicio'),
  modulo: tablaFalsa('modulo'),
  profesional: tablaFalsa('profesional'),
  cita: tablaFalsa('cita'),
  cargaCitas: tablaFalsa('cargaCitas'),
  // La carga le pasa las escrituras ya lanzadas; aqui solo hay que esperarlas.
  async $transaction(operaciones) {
    return Promise.all(operaciones)
  },
}

mock.module(comoUrl('lib/prisma.ts'), { namedExports: { prisma: prismaFalso } })
mock.module(comoUrl('lib/citas/jornadas.ts'), {
  namedExports: { recalcularJornadas: async () => ({ ajustes: [] }) },
})

// --- El archivo del hospital ---

const escapar = (texto) => String(texto).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Una cita del reporte, con valores de ejemplo para lo que no se indique. */
export function filaDelReporte(cambios = {}) {
  return {
    fecha: '30/12/2030',
    hora: '07:10',
    tipoDocumento: 'CC',
    documento: '1001',
    nombrePaciente: 'PACIENTE DE PRUEBA',
    procedimiento: 'CONSULTA DE PRIMERA VEZ POR MEDICINA GENERAL',
    consultorio: 'CONS 01- CONSULTA EXTERNA',
    profesional: 'DRA PRUEBA UNO',
    ...cambios,
  }
}

/** El XML del servidor de informes, con una etiqueta `<Detalles>` por cita. */
export function reporteXml(filas) {
  const detalles = filas.map(
    (f) =>
      `<Detalles fecha_inicio="${escapar(f.fecha)}" hora_inicio="${escapar(f.hora)}" tipo_documento="${escapar(f.tipoDocumento)}" numero_documento1="${escapar(f.documento)}" nombre_paciente="${escapar(f.nombrePaciente)}" cusp="890201" NombreProcedimiento="${escapar(f.procedimiento)}" descripcion_consultorio="${escapar(f.consultorio)}" nombre_profesional="${escapar(f.profesional)}" />`,
  )
  return new TextEncoder().encode(
    `<?xml version="1.0" encoding="utf-8"?><Report><Detalles_Collection>${detalles.join('\n')}</Detalles_Collection></Report>`,
  )
}

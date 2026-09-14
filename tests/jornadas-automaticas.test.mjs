// Cada carga de agenda organiza sola la jornada de los doctores.
//
// ES UNA CONDICION PERMANENTE DEL SISTEMA, no una herramienta que alguien
// recuerde usar: el reporte del hospital no trae ninguna columna que diga en
// que jornada trabaja cada quien, y sin deducirla todos quedan de "dia
// completo". El efecto se ve en la parrilla de Citas: el medico que se va a las
// once aparece tambien en la tarde, y a alguien que a esa hora no esta en el
// hospital se le puede citar un paciente a las tres.
//
// Los casos de aqui son los del hospital de verdad, con sus horarios reales.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Antes que nada: `jornadas.ts` lee la configuracion por el repositorio, y sin
// esto iria contra la base de datos del hospital.
await import('./repositorios-en-memoria.mjs')

const RAIZ = path.resolve(import.meta.dirname, '..')
const comoUrl = (relativa) => pathToFileURL(path.join(RAIZ, relativa)).href

/** Doctores y citas de mentira, en lugar de la base. */
const estado = { doctores: [], citas: [] }

const prismaFalso = {
  cita: {
    async findMany({ where }) {
      return estado.citas.filter(
        (c) =>
          where.fecha.in.includes(c.fecha) &&
          c.estado !== 'CANCELADA' &&
          (!where.profesionalId || where.profesionalId.in.includes(c.profesionalId)),
      )
    },
  },
  profesional: {
    async findMany({ where }) {
      return estado.doctores.filter((d) =>
        where.id ? where.id.in.includes(d.id) : d.activo === where.activo,
      )
    },
    async updateMany({ where, data }) {
      let count = 0
      for (const doctor of estado.doctores) {
        if (!where.id.in.includes(doctor.id)) continue
        doctor.jornada = data.jornada
        count += 1
      }
      return { count }
    },
  },
  // El codigo le pasa las operaciones ya lanzadas; aqui solo hay que esperarlas.
  async $transaction(operaciones) {
    return Promise.all(operaciones)
  },
}

mock.module(comoUrl('lib/prisma.ts'), { namedExports: { prisma: prismaFalso } })

const { recalcularJornadas } = await import('@/lib/citas/jornadas')

const DIA = '2026-09-14'

/** Instante ISO de una hora de ese dia EN COLOMBIA. */
const enColombia = (hora) => new Date(`${DIA}T${hora}:00-05:00`)

/**
 * Deja preparado un dia: doctores todos en COMPLETA (como entran de la carga) y
 * sus citas a las horas que se indiquen.
 */
function sembrar(doctores) {
  estado.doctores = doctores.map(({ id, nombre }) => ({
    id,
    nombre,
    jornada: 'COMPLETA',
    activo: true,
  }))
  estado.citas = doctores.flatMap(({ id, horas }) =>
    horas.map((hora, i) => ({
      id: `${id}-${i}`,
      profesionalId: id,
      fecha: DIA,
      horaCita: enColombia(hora),
      estado: 'PROGRAMADA',
    })),
  )
}

const jornadaDe = (id) => estado.doctores.find((d) => d.id === id).jornada

test('la carga reparte a cada doctor en su jornada segun las horas de sus citas', async () => {
  // Los cuatro casos del hospital, con sus horarios de verdad.
  sembrar([
    { id: 'millan', nombre: 'ERNESTO MILLAN', horas: ['07:00', '09:30', '11:20'] },
    { id: 'paternina', nombre: 'DAGOBERTO PATERNINA', horas: ['14:00', '15:10', '16:08'] },
    { id: 'macea', nombre: 'ALVARO MACEA', horas: ['07:00', '11:00', '14:30', '16:14'] },
    { id: 'de-leon', nombre: 'CARLOS DE LEON', horas: ['12:20', '14:00', '16:14'] },
  ])

  const ajustes = await recalcularJornadas({ fechas: [DIA] })

  assert.equal(jornadaDe('millan'), 'MANANA', 'de 07:00 a 11:20 es jornada de la mañana')
  assert.equal(jornadaDe('paternina'), 'TARDE', 'de 14:00 a 16:08 es jornada de la tarde')
  assert.equal(jornadaDe('macea'), 'COMPLETA', 'de 07:00 a 16:14 es el dia completo')

  // EL CASO QUE SE ESCAPABA. De 12:20 a 16:14 es la tarde entrando antes del
  // almuerzo. Contando las 12:20 como mañana salia de "dia completo", y en el
  // hospital hay cuatro doctores asi: media parrilla de la mañana era mentira.
  assert.equal(jornadaDe('de-leon'), 'TARDE', 'de 12:20 a 16:14 es jornada de la tarde')

  // Se informa de lo que cambio, para que el resumen de la carga lo enseñe: es
  // un cambio que mueve a los doctores de sitio en la agenda.
  assert.deepEqual(
    ajustes.map((a) => `${a.nombre}: ${a.jornada}`),
    ['CARLOS DE LEON: TARDE', 'DAGOBERTO PATERNINA: TARDE', 'ERNESTO MILLAN: MANANA'],
  )
})

test('al doctor que no trae ninguna cita no se le toca la jornada', async () => {
  // Sin citas no hay nada que deducir. Ponerle una seria inventarle el horario
  // a quien no aparece en el reporte, y pisarle al administrador la que puso a
  // mano en Profesionales.
  sembrar([{ id: 'sin-agenda', nombre: 'DR SIN AGENDA', horas: [] }])
  estado.doctores[0].jornada = 'TARDE'

  const ajustes = await recalcularJornadas({ fechas: [DIA] })

  assert.equal(jornadaDe('sin-agenda'), 'TARDE')
  assert.equal(ajustes.length, 0)
})

test('volver a subir el mismo archivo no cambia nada la segunda vez', async () => {
  sembrar([{ id: 'millan', nombre: 'ERNESTO MILLAN', horas: ['07:00', '11:20'] }])

  const primera = await recalcularJornadas({ fechas: [DIA] })
  const segunda = await recalcularJornadas({ fechas: [DIA] })

  assert.equal(primera.length, 1)
  assert.equal(segunda.length, 0, 'ya estaba bien: no hay nada que ajustar')
  assert.equal(jornadaDe('millan'), 'MANANA')
})

test('la cita cancelada no cuenta para deducir la jornada', async () => {
  // Si contara, un doctor de mañana al que le cancelaron la unica cita de la
  // tarde se quedaria de dia completo para siempre.
  sembrar([{ id: 'millan', nombre: 'ERNESTO MILLAN', horas: ['07:00', '11:20', '15:00'] }])
  estado.citas.find((c) => c.horaCita.getTime() === enColombia('15:00').getTime()).estado = 'CANCELADA'

  await recalcularJornadas({ fechas: [DIA] })

  assert.equal(jornadaDe('millan'), 'MANANA')
})

test('la carga solo opina de los doctores que trae el archivo', async () => {
  // Un reporte puede venir filtrado por un doctor. Que eso le cambie la jornada
  // a los demas seria dejar que un archivo parcial reescriba medio catalogo.
  sembrar([
    { id: 'millan', nombre: 'ERNESTO MILLAN', horas: ['07:00', '11:20'] },
    { id: 'paternina', nombre: 'DAGOBERTO PATERNINA', horas: ['14:00', '16:08'] },
  ])

  await recalcularJornadas({ fechas: [DIA], profesionalIds: ['millan'] })

  assert.equal(jornadaDe('millan'), 'MANANA')
  assert.equal(jornadaDe('paternina'), 'COMPLETA', 'no venia en el archivo: no se toca')
})

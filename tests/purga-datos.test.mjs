// La purga de datos de pacientes: los dias viejos pierden el nombre y el
// documento y conservan todo lo demas.
//
// ES LA UNICA OPERACION DEL SISTEMA QUE NO SE DESHACE, asi que lo que se prueba
// aqui no es que funcione: es que no alcance a nada que no deba. Que no toque
// hoy, que no toque el futuro, que no choque contra el indice unico cuando dos
// pacientes comparten hora con el mismo doctor, y que lo que se queda siga
// sirviendo para medir inasistencia y deducir jornadas, que es todo el motivo
// de anonimizar en vez de borrar la fila.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RAIZ = path.resolve(import.meta.dirname, '..')
const comoUrl = (relativa) => pathToFileURL(path.join(RAIZ, relativa)).href

/** Citas y turnos de mentira, en lugar de la base. */
const estado = { citas: [], turnos: [] }

const cumple = (fila, where) => {
  if (where.fecha?.lt && !(fila.fecha < where.fecha.lt)) return false
  if (where.documentoPaciente?.not?.startsWith) {
    if (fila.documentoPaciente.startsWith(where.documentoPaciente.not.startsWith)) return false
  }
  if (where.nombrePaciente) {
    if (where.nombrePaciente.not === null && fila.nombrePaciente === null) return false
    if (where.nombrePaciente.notIn?.includes(fila.nombrePaciente)) return false
  }
  return true
}

const prismaFalso = {
  cita: {
    async findMany({ where, select }) {
      const filas = estado.citas.filter((c) => cumple(c, where))
      return select?.id ? filas.map((c) => ({ id: c.id })) : filas
    },
    async groupBy({ where }) {
      const porFecha = new Map()
      for (const cita of estado.citas.filter((c) => cumple(c, where))) {
        porFecha.set(cita.fecha, (porFecha.get(cita.fecha) ?? 0) + 1)
      }
      return [...porFecha].map(([fecha, n]) => ({ fecha, _count: { _all: n } }))
    },
    async update({ where, data }) {
      const cita = estado.citas.find((c) => c.id === where.id)
      Object.assign(cita, data)
      // El indice unico de verdad. Sin esto la prueba pasaria con una purga
      // que en la base real se cae a la mitad.
      const clave = `${cita.fecha}|${cita.documentoPaciente}|${cita.profesionalId}|${cita.horaCita}`
      const repetida = estado.citas.filter(
        (c) => `${c.fecha}|${c.documentoPaciente}|${c.profesionalId}|${c.horaCita}` === clave,
      )
      if (repetida.length > 1) {
        throw new Error('Unique constraint failed on the fields: (citaDelDia)')
      }
      return cita
    },
  },
  turno: {
    async count({ where }) {
      return estado.turnos.filter((t) => cumple(t, where)).length
    },
    async updateMany({ where, data }) {
      const filas = estado.turnos.filter((t) => cumple(t, where))
      for (const turno of filas) Object.assign(turno, data)
      return { count: filas.length }
    },
  },
  async $transaction(operaciones) {
    return Promise.all(operaciones)
  },
}

mock.module(comoUrl('lib/prisma.ts'), { namedExports: { prisma: prismaFalso } })

const { limiteDeRetencion, previsualizarPurga, purgarDatosDePacientes } = await import(
  '@/lib/citas/purga'
)

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
const enDias = (dias) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(
    new Date(Date.now() + dias * 24 * 60 * 60 * 1000),
  )

let n = 0
function cita({ fecha, hora = '09:00', documento = '1001', profesionalId = 'pro-1' }) {
  const fila = {
    id: `cita-${(n += 1)}`,
    fecha,
    horaCita: `${fecha}T${hora}:00-05:00`,
    documentoPaciente: documento,
    nombrePaciente: 'MARIA ALEJANDRA CARDOZO LOPEZ',
    tipoDocumento: 'CC',
    procedimiento: 'CONSULTA DE PRIMERA VEZ',
    cups: '890201',
    profesionalId,
    estado: 'PROGRAMADA',
  }
  estado.citas.push(fila)
  return fila
}

function turno({ fecha, nombre = 'MARIA ALEJANDRA CARDOZO LOPEZ' }) {
  const fila = { id: `turno-${(n += 1)}`, fecha, nombrePaciente: nombre }
  estado.turnos.push(fila)
  return fila
}

function limpiar() {
  estado.citas = []
  estado.turnos = []
}

test('el limite de retencion deja pasar los meses pedidos y no admite menos de uno', () => {
  const limite = limiteDeRetencion(6)
  assert.match(limite, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(limite < hoy(), 'el limite siempre queda en el pasado')

  assert.throws(() => limiteDeRetencion(0), /al menos 1 mes/i)
  assert.throws(() => limiteDeRetencion(-3), /al menos 1 mes/i)
})

test('anonimiza lo viejo y no toca ni hoy ni lo que viene', async () => {
  limpiar()
  const vieja = cita({ fecha: '2020-01-15' })
  const deHoy = cita({ fecha: hoy(), documento: '2002' })
  const futura = cita({ fecha: enDias(3), documento: '3003' })

  const limite = enDias(-1)
  const previo = await previsualizarPurga(limite)
  assert.equal(previo.citas, 1, 'solo la vieja entra en la cuenta')

  await purgarDatosDePacientes(limite)

  assert.equal(vieja.nombrePaciente, 'Paciente anonimizado')
  assert.equal(vieja.tipoDocumento, null)
  assert.equal(vieja.procedimiento, null)
  assert.equal(vieja.cups, null)
  assert.ok(vieja.documentoPaciente.startsWith('ANON-'))

  // EL PACIENTE QUE ESTA EN LA SALA AHORA MISMO. Anonimizarlo seria llamarlo a
  // consulta sin nombre, con el turno en la mano.
  assert.equal(deHoy.nombrePaciente, 'MARIA ALEJANDRA CARDOZO LOPEZ')
  assert.equal(deHoy.documentoPaciente, '2002')
  assert.equal(futura.nombrePaciente, 'MARIA ALEJANDRA CARDOZO LOPEZ')
})

test('lo que se conserva es lo que sostiene la inasistencia y las jornadas', async () => {
  limpiar()
  const vieja = cita({ fecha: '2020-01-15', hora: '13:12', profesionalId: 'macea' })

  await purgarDatosDePacientes(enDias(-1))

  // Es todo el motivo de anonimizar en vez de borrar la fila: la inasistencia
  // se mide comparando las citas del dia contra los turnos, y la jornada de un
  // dia sale de las horas de sus citas. Las dos cosas siguen enteras.
  assert.equal(vieja.fecha, '2020-01-15')
  assert.equal(vieja.horaCita, '2020-01-15T13:12:00-05:00')
  assert.equal(vieja.profesionalId, 'macea')
  assert.equal(vieja.estado, 'PROGRAMADA')
})

test('dos pacientes con el mismo doctor a la misma hora no chocan contra el indice unico', async () => {
  // PASA EN EL HOSPITAL y el sistema lo sostiene a proposito. Poniendoles a los
  // dos el mismo documento anonimo, la segunda fila rompe el indice
  // `[fecha, documentoPaciente, profesionalId, horaCita]` y la purga se cae a
  // la mitad, con parte de los dias anonimizados y parte no.
  limpiar()
  const primera = cita({ fecha: '2020-02-10', hora: '09:00', documento: '111' })
  const segunda = cita({ fecha: '2020-02-10', hora: '09:00', documento: '222' })

  await assert.doesNotReject(() => purgarDatosDePacientes(enDias(-1)))

  assert.notEqual(primera.documentoPaciente, segunda.documentoPaciente)
  assert.ok(primera.documentoPaciente.startsWith('ANON-'))
  assert.ok(segunda.documentoPaciente.startsWith('ANON-'))
})

test('los turnos tambien pierden el nombre: guardan su propia copia', async () => {
  limpiar()
  const viejo = turno({ fecha: '2020-01-15' })
  const deHoy = turno({ fecha: hoy() })

  const resumen = await purgarDatosDePacientes(enDias(-1))

  assert.equal(resumen.turnos, 1)
  assert.equal(viejo.nombrePaciente, 'Paciente anonimizado')
  assert.equal(deHoy.nombrePaciente, 'MARIA ALEJANDRA CARDOZO LOPEZ')
})

test('repetir la purga no cuenta ni vuelve a tocar lo ya anonimizado', async () => {
  limpiar()
  cita({ fecha: '2020-01-15' })
  turno({ fecha: '2020-01-15' })

  const primera = await purgarDatosDePacientes(enDias(-1))
  const segunda = await purgarDatosDePacientes(enDias(-1))

  assert.equal(primera.citas, 1)
  assert.equal(primera.turnos, 1)
  assert.equal(segunda.citas, 0, 'ya estaba anonimizada')
  assert.equal(segunda.turnos, 0)
})

test('no se puede purgar hoy ni una fecha futura', async () => {
  limpiar()
  await assert.rejects(() => purgarDatosDePacientes(hoy()), /Hoy no se purga/i)
  await assert.rejects(() => purgarDatosDePacientes(enDias(1)), /no ha pasado todavia/i)
  await assert.rejects(() => previsualizarPurga(enDias(30)), /no ha pasado todavia/i)
})

test('una fecha con formato invalido se rechaza antes de tocar nada', async () => {
  limpiar()
  const vieja = cita({ fecha: '2020-01-15' })

  await assert.rejects(() => purgarDatosDePacientes('15/01/2020'), /no es valida/i)
  await assert.rejects(() => purgarDatosDePacientes(''), /no es valida/i)

  assert.equal(vieja.nombrePaciente, 'MARIA ALEJANDRA CARDOZO LOPEZ')
})

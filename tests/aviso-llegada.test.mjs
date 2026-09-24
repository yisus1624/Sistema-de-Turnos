// La llegada del paciente tiene que llegarle al doctor AL INSTANTE.
//
// Antes registrar la llegada en admisiones no publicaba nada en el hub de
// eventos: la pantalla del consultorio solo se enteraba en su siguiente
// refresco periodico, hasta quince segundos despues. Estas pruebas fijan el
// aviso en vivo y, sobre todo, que ese aviso NO lleve datos del paciente: el
// mismo canal lo escucha la pantalla de la sala de espera, que no tiene sesion.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RAIZ = path.resolve(import.meta.dirname, '..')
const comoUrl = (relativa) => pathToFileURL(path.join(RAIZ, relativa)).href

// La sesion del funcionario de admisiones que registra la llegada, y el ambito
// de peticion que los handlers necesitan para anotar la IP en la auditoria:
// fuera de un servidor Next no existen. Ver `autorizacion-rutas.test.mjs`.
mock.module(comoUrl('lib/auth.ts'), {
  namedExports: {
    auth: async () => ({ user: { id: 'usr-admisiones', rol: 'OPERADOR', secciones: null } }),
    handlers: {},
    signIn: async () => {},
    signOut: async () => {},
  },
})
mock.module(comoUrl('node_modules/next/headers.js'), {
  namedExports: {
    headers: async () => new Headers({ 'user-agent': 'prueba' }),
    cookies: async () => ({ get: () => undefined, getAll: () => [] }),
    draftMode: async () => ({ isEnabled: false }),
  },
})

// El registro de seguridad escribe en la base con Prisma y el repositorio en
// memoria no lo cubre: la llegada registrada por la ruta apuntaba su evento en
// la base de DATABASE_URL. Ver `autorizacion-rutas.test.mjs`.
const registroReal = await import(comoUrl('lib/seguridad/registro.ts'))
mock.module(comoUrl('lib/seguridad/registro.ts'), {
  namedExports: {
    ...registroReal,
    registrarEvento: async () => {},
    listarEventos: async () => [],
    tiposDeEvento: async () => [],
  },
})

// Las pruebas nunca tocan la base de datos real. Ver el modulo.
await import('./repositorios-en-memoria.mjs')

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')
const { realtimeHub } = await import('@/lib/realtime/hub')
const { avisarFilaCambiada } = await import('@/lib/realtime/avisos')

const repo = new InMemoryTurnoRepository()

function diaColombia(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(fecha)
}

const HOY = diaColombia()

function enFranja(hora) {
  return new Date(`${HOY}T${hora}:00-05:00`).toISOString()
}

/** Recoge lo que se publique en el hub mientras corre `tarea`. */
async function eventosDurante(tarea) {
  const recogidos = []
  const cancelar = realtimeHub.subscribe((evento) => recogidos.push(evento))
  try {
    await tarea()
  } finally {
    cancelar()
  }
  return recogidos
}

let creados = 0
async function doctorConCitaDeHoy() {
  creados += 1
  const modulo = await repo.crearModulo({
    nombre: `Consultorio aviso ${creados}`,
    servicioId: 'srv-consulta-externa',
    activo: true,
  })
  const doctor = await repo.crearProfesional({
    nombre: `Dr. Aviso ${creados}`,
    servicioId: 'srv-consulta-externa',
    jornada: 'COMPLETA',
    moduloId: modulo.id,
  })
  const cita = await repo.crearCita({
    documentoPaciente: String(910000 + creados),
    nombrePaciente: `Paciente Aviso ${creados}`,
    profesionalId: doctor.id,
    horaCita: enFranja('08:00'),
    usuarioId: 'usuario-mostrador',
  })
  return { doctor, cita }
}

test('registrar la llegada avisa en vivo a la fila del profesional', async () => {
  const { doctor, cita } = await doctorConCitaDeHoy()

  const eventos = await eventosDurante(async () => {
    const { turno } = await repo.registrarLlegada(cita.id)
    avisarFilaCambiada(turno)
  })

  const aviso = eventos.find((evento) => evento.tipo === 'fila.cambiada')
  assert.ok(aviso, 'la llegada publica un cambio de fila')
  assert.equal(aviso.profesionalId, doctor.id, 'el doctor que espera al paciente')
  assert.equal(aviso.servicioId, 'srv-consulta-externa')
})

test('el aviso de llegada no lleva ningun dato del paciente', async () => {
  const { cita } = await doctorConCitaDeHoy()

  const eventos = await eventosDurante(async () => {
    const { turno } = await repo.registrarLlegada(cita.id)
    avisarFilaCambiada(turno)
  })

  const aviso = eventos.find((evento) => evento.tipo === 'fila.cambiada')
  const enviado = JSON.stringify(aviso)
  assert.ok(!enviado.includes('Paciente Aviso'), 'ni el nombre')
  assert.ok(!enviado.includes(cita.documentoPaciente), 'ni el documento')
  assert.ok(!enviado.includes('codigo'), 'ni el codigo del turno: eso no lo necesita quien escucha')
})

test('un turno de ventanilla avisa la fila del servicio, sin profesional', async () => {
  // La fila compartida la atienden varias ventanillas a la vez: el turno que
  // genera una tiene que aparecerle a la otra sin que pulse nada.
  const servicio = await repo.crearServicio({
    nombre: 'Facturacion aviso',
    prefijo: 'FA',
    modoFila: 'COMPARTIDA',
    activo: true,
  })

  const eventos = await eventosDurante(async () => {
    const turno = await repo.generarTurnoDeVentanilla(servicio.id)
    avisarFilaCambiada(turno)
  })

  const aviso = eventos.find((evento) => evento.tipo === 'fila.cambiada')
  assert.ok(aviso)
  assert.equal(aviso.profesionalId, null)
  assert.equal(aviso.servicioId, servicio.id)
})

test('la RUTA de admisiones publica el aviso, no solo el ayudante', async () => {
  // Las pruebas de arriba llaman a `avisarFilaCambiada` a mano: comprueban el
  // ayudante, pero no que la ruta lo use. Si alguien borra esa linea del
  // handler, el doctor vuelve a no enterarse de la llegada y aquellas pruebas
  // seguirian en verde. Esta invoca el handler de verdad.
  const { turnoRepository } = await import('@/lib/turnos/repositorio')
  const { POST } = await import('@/app/api/turnos/citas/llegada/route')

  const modulo = await turnoRepository.crearModulo({
    nombre: 'Consultorio ruta llegada',
    servicioId: 'srv-consulta-externa',
    activo: true,
  })
  const doctor = await turnoRepository.crearProfesional({
    nombre: 'Dra. Ruta Llegada',
    servicioId: 'srv-consulta-externa',
    jornada: 'COMPLETA',
    moduloId: modulo.id,
  })
  const cita = await turnoRepository.crearCita({
    documentoPaciente: '920001',
    nombrePaciente: 'Paciente De Ruta',
    profesionalId: doctor.id,
    horaCita: enFranja('09:00'),
    usuarioId: 'usr-admisiones',
  })

  const eventos = await eventosDurante(async () => {
    const respuesta = await POST(
      new Request('http://localhost/api/turnos/citas/llegada', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ citaId: cita.id }),
      }),
    )
    assert.equal(respuesta.status, 200, 'la llegada se registro')
  })

  const aviso = eventos.find((evento) => evento.tipo === 'fila.cambiada')
  assert.ok(aviso, 'registrar la llegada tiene que avisar en vivo a la fila del doctor')
  assert.equal(aviso.profesionalId, doctor.id)
  // Y por el canal publico no viaja el paciente.
  const enviado = JSON.stringify(aviso)
  assert.ok(!enviado.includes('Paciente De Ruta'))
  assert.ok(!enviado.includes('920001'))
})

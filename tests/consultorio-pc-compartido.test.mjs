// En un PC compartido, un doctor no puede llamar ni cerrar pacientes de otro.
//
// Hay UNA cookie de consultorio por navegador. Si en el mismo navegador se abre
// el enlace de otro doctor, la cookie cambia y las pestañas que ya estaban
// abiertas pasaban a actuar como ese otro sin avisar. Y el servidor llamaba
// desde el `moduloId` que mandaba la pantalla, fuera cual fuera: la pestaña del
// Dr. A, con la cookie del Dr. B, pulsaba "Llamar siguiente" y se llamaba al
// paciente de B hacia la puerta de A, cerrandole a B el que tenia adentro.
//
// Ahora la pantalla dice a quien muestra (`profesionalId`) y, si no es el de la
// cookie, el servidor responde 409 sin tocar nada. El consultorio lo pone el
// servidor: el asignado al doctor. Las pestañas viejas, que no mandan
// `profesionalId`, siguen funcionando como antes hasta que recarguen.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

// ANTES QUE NADA, y antes de cualquier route handler: sin esto las pruebas
// escriben en la base de datos REAL del hospital.
const { turnoRepository } = await import('./repositorios-en-memoria.mjs')

mock.module('@/lib/auth', { namedExports: { auth: async () => null } })
mock.module('@/lib/seguridad/registro', {
  namedExports: {
    registrarEvento: async () => {},
    contextoPeticion: async () => ({ ip: null, agente: 'pruebas' }),
    limitarIntentos: () => ({ permitido: true, reintentarEnSegundos: 0 }),
    limpiarIntentos: () => {},
    listarEventos: async () => [],
    tiposDeEvento: async () => [],
    confiarEnProxy: false,
  },
})
mock.module('next/headers', { namedExports: { headers: async () => new Headers() } })

const rutaLlamar = await import('@/app/api/consultorio/llamar-siguiente/route')
const rutaAtendido = await import('@/app/api/consultorio/turnos/[turnoId]/atendido/route')
const rutaAusente = await import('@/app/api/consultorio/turnos/[turnoId]/ausente/route')
const rutaRepetir = await import('@/app/api/consultorio/turnos/[turnoId]/repetir/route')
const rutaRetroceder = await import('@/app/api/consultorio/retroceder/route')

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
const parametros = (valores) => ({ params: Promise.resolve(valores) })

/** Una peticion de la pantalla del consultorio, con la cookie de ese navegador. */
function desdeElNavegador(cookie, cuerpo) {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { cookie },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
}

let creados = 0
async function doctorConConsultorio({ conConsultorio = true } = {}) {
  creados += 1
  const modulo = conConsultorio
    ? await turnoRepository.crearModulo({ nombre: `Consultorio compartido ${creados}`, servicioId: 'srv-consulta-externa', activo: true })
    : null
  const doctor = await turnoRepository.crearProfesional({
    nombre: `Dr. Compartido ${creados}`,
    servicioId: 'srv-consulta-externa',
    jornada: 'COMPLETA',
    moduloId: modulo?.id ?? null,
  })
  const { token } = await turnoRepository.crearAccesoProfesional(doctor.id, 60)
  return { doctor, modulo, cookie: `turnos_consultorio=${token}` }
}

let documentos = 700000
async function pacienteEnEspera(profesionalId, hora) {
  documentos += 1
  const cita = await turnoRepository.crearCita({
    documentoPaciente: String(documentos),
    nombrePaciente: `Paciente ${documentos}`,
    profesionalId,
    horaCita: new Date(`${HOY}T${hora}:00-05:00`).toISOString(),
  })
  return (await turnoRepository.registrarLlegada(cita.id)).turno
}

const estadoDe = async (turno) =>
  (await turnoRepository.historico({ codigo: turno.codigo, fecha: HOY })).find((t) => t.id === turno.id)

/** El Dr. A y el Dr. B, cada uno con su consultorio y su paciente en espera. */
async function dosDoctoresEnUnPc() {
  const a = await doctorConConsultorio()
  const b = await doctorConConsultorio()
  a.enEspera = await pacienteEnEspera(a.doctor.id, '08:00')
  b.enEspera = await pacienteEnEspera(b.doctor.id, '08:00')
  return { a, b }
}

// --- Llamar al siguiente ------------------------------------------------------

test('la pestaña del Dr. A con la cookie del Dr. B no llama a nadie: 409 y la fila de B queda igual', async () => {
  const { a, b } = await dosDoctoresEnUnPc()

  const respuesta = await rutaLlamar.POST(
    desdeElNavegador(b.cookie, { moduloId: a.modulo.id, turnoAbiertoId: null, profesionalId: a.doctor.id }),
  )
  const cuerpo = await respuesta.json()

  assert.equal(respuesta.status, 409)
  assert.match(cuerpo.error, /otro doctor/i)
  assert.equal(cuerpo.turnoActual, undefined, 'no es el 409 de "ya tenias un paciente": la pantalla no debe adoptar nada')
  assert.equal((await estadoDe(b.enEspera)).estado, 'EN_ESPERA', 'el paciente de B sigue esperando')
})

test('el consultorio lo pone el servidor: el asignado al doctor, no el que mande la pantalla', async () => {
  const { a, b } = await dosDoctoresEnUnPc()

  // Una pestaña vieja (sin `profesionalId`) que dice ser del consultorio de A.
  const respuesta = await rutaLlamar.POST(desdeElNavegador(b.cookie, { moduloId: a.modulo.id, turnoAbiertoId: null }))
  const { turno } = await respuesta.json()

  assert.equal(respuesta.status, 200)
  assert.equal(turno.id, b.enEspera.id)
  assert.equal(turno.moduloId, b.modulo.id, 'al paciente de B se le llama a la puerta de B')
})

test('una pestaña de antes de este cambio (sin profesionalId) sigue llamando como siempre', async () => {
  const { a } = await dosDoctoresEnUnPc()

  const respuesta = await rutaLlamar.POST(desdeElNavegador(a.cookie, { moduloId: a.modulo.id, turnoAbiertoId: null }))

  assert.equal(respuesta.status, 200)
})

test('la pantalla que declara al mismo doctor de la cookie llama normal, aunque ya no mande consultorio', async () => {
  const { a } = await dosDoctoresEnUnPc()

  const respuesta = await rutaLlamar.POST(
    desdeElNavegador(a.cookie, { turnoAbiertoId: null, profesionalId: a.doctor.id }),
  )
  const { turno } = await respuesta.json()

  assert.equal(respuesta.status, 200)
  assert.equal(turno.moduloId, a.modulo.id)
})

test('un doctor sin consultorio asignado no llama en uno cualquiera: se le dice por que', async () => {
  const sinConsultorio = await doctorConConsultorio({ conConsultorio: false })
  const enEspera = await pacienteEnEspera(sinConsultorio.doctor.id, '08:30')

  const respuesta = await rutaLlamar.POST(
    desdeElNavegador(sinConsultorio.cookie, { moduloId: 'mod-consultorio-1', turnoAbiertoId: null }),
  )
  const cuerpo = await respuesta.json()

  assert.equal(respuesta.status, 400)
  assert.match(cuerpo.error, /no tienes consultorio asignado/i)
  assert.equal((await estadoDe(enEspera)).estado, 'EN_ESPERA')
})

// --- Atendido, ausente, repetir y retroceder --------------------------------

/** B con su paciente adentro (LLAMADO) y la cookie de B en el navegador. */
async function pacienteDeBAdentro() {
  const { a, b } = await dosDoctoresEnUnPc()
  const llamado = await turnoRepository.llamarSiguiente({
    profesionalId: b.doctor.id,
    moduloId: b.modulo.id,
    funcionarioId: b.doctor.id,
    turnoAbiertoEsperado: null,
  })
  return { a, b, llamado }
}

for (const [nombre, ruta] of [
  ['Atendido', rutaAtendido],
  ['No se presento', rutaAusente],
]) {
  test(`"${nombre}" desde la pestaña de A, con la cookie de B: 409 y el paciente de B sigue adentro`, async () => {
    const { a, b, llamado } = await pacienteDeBAdentro()

    const respuesta = await ruta.POST(
      desdeElNavegador(b.cookie, { profesionalId: a.doctor.id }),
      parametros({ turnoId: llamado.id }),
    )

    assert.equal(respuesta.status, 409)
    assert.match((await respuesta.json()).error, /otro doctor/i)
    assert.equal((await estadoDe(llamado)).estado, 'LLAMADO')
  })

  test(`"${nombre}" con el doctor correcto, o desde una pestaña vieja, sigue funcionando`, async () => {
    const { b, llamado } = await pacienteDeBAdentro()
    const respuesta = await ruta.POST(
      desdeElNavegador(b.cookie, { profesionalId: b.doctor.id }),
      parametros({ turnoId: llamado.id }),
    )
    assert.equal(respuesta.status, 200)

    const otro = await pacienteDeBAdentro()
    const vieja = await ruta.POST(desdeElNavegador(otro.b.cookie), parametros({ turnoId: otro.llamado.id }))
    assert.equal(vieja.status, 200, 'sin cuerpo, como la pestaña de antes')
  })
}

test('"Repetir" desde la pestaña de A, con la cookie de B: 409 y no vuelve a sonar', async () => {
  const { a, b, llamado } = await pacienteDeBAdentro()

  const respuesta = await rutaRepetir.POST(
    desdeElNavegador(b.cookie, { vecesLlamadoVisto: 1, profesionalId: a.doctor.id }),
    parametros({ turnoId: llamado.id }),
  )

  assert.equal(respuesta.status, 409)
  assert.equal((await estadoDe(llamado)).vecesLlamado, 1)

  const bien = await rutaRepetir.POST(
    desdeElNavegador(b.cookie, { vecesLlamadoVisto: 1, profesionalId: b.doctor.id }),
    parametros({ turnoId: llamado.id }),
  )
  assert.equal(bien.status, 200)
  assert.equal((await estadoDe(llamado)).vecesLlamado, 2)
})

test('"Retroceder" desde la pestaña de A, con la cookie de B: 409 y el paciente de B no vuelve a la fila', async () => {
  const { a, b, llamado } = await pacienteDeBAdentro()
  const visto = { turnoAbiertoId: llamado.id, restaurarId: null }

  const respuesta = await rutaRetroceder.POST(desdeElNavegador(b.cookie, { ...visto, profesionalId: a.doctor.id }))

  assert.equal(respuesta.status, 409)
  assert.equal((await estadoDe(llamado)).estado, 'LLAMADO')

  const bien = await rutaRetroceder.POST(desdeElNavegador(b.cookie, { ...visto, profesionalId: b.doctor.id }))
  assert.equal(bien.status, 200)
  assert.equal((await estadoDe(llamado)).estado, 'EN_ESPERA')
})

// --- La pantalla se da cuenta de que cambio de doctor -------------------------

const { cambioDeDoctor } = await import('@/lib/consultorio/presentacion')

test('al recargar con la cookie de otro doctor, la pantalla lo detecta y dice de quien a quien', () => {
  const ana = { id: 'pro-ana', nombre: 'Dra. Ana Torres' }
  const beto = { id: 'pro-beto', nombre: 'Dr. Beto Ruiz' }

  assert.equal(cambioDeDoctor(null, ana), null, 'la primera carga no es un cambio')
  assert.equal(cambioDeDoctor(ana, { ...ana, nombre: 'Dra. Ana Torres Ruiz' }), null, 'el mismo doctor no es un cambio')
  assert.deepEqual(cambioDeDoctor(ana, beto), { antes: 'Dra. Ana Torres', ahora: 'Dr. Beto Ruiz' })
})

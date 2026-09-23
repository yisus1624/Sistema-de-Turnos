// Que no se pierda ni se cierre mal ningun turno cuando la red falla.
//
// El caso que origina todo: el servidor llama al paciente A, la respuesta se
// pierde por el camino y la recarga tambien falla. El doctor, viendo aun la
// pantalla vieja, vuelve a pulsar "Llamar siguiente". Antes eso llamaba a B y
// cerraba a A como ATENDIDO sin que hubiera entrado. Ahora el cliente dice que
// turno cree tener abierto y, si no coincide con el real, el servidor se niega
// con un 409 y le devuelve el estado verdadero.
//
// Se prueba contra el CONTRATO con la implementacion en memoria: la de
// PostgreSQL tiene que comportarse igual.
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

const repo = new InMemoryTurnoRepository()
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())

let creados = 0
async function doctorConConsultorio() {
  creados += 1
  const modulo = await repo.crearModulo({
    nombre: `Consultorio sin perdidas ${creados}`,
    servicioId: 'srv-consulta-externa',
    activo: true,
  })
  const doctor = await repo.crearProfesional({
    nombre: `Dr. Sin Perdidas ${creados}`,
    servicioId: 'srv-consulta-externa',
    jornada: 'COMPLETA',
    moduloId: modulo.id,
  })
  return { doctor, modulo }
}

let documentos = 700000
async function citaDeHoy(profesionalId, hora = '09:00') {
  documentos += 1
  return repo.crearCita({
    documentoPaciente: String(documentos),
    nombrePaciente: `Paciente ${documentos}`,
    profesionalId,
    horaCita: new Date(`${HOY}T${hora}:00-05:00`).toISOString(),
  })
}

async function enEspera(profesionalId, hora) {
  const { turno } = await repo.registrarLlegada((await citaDeHoy(profesionalId, hora)).id)
  return turno
}

function llamarComoDoctor({ doctor, modulo }, turnoAbiertoEsperado) {
  return repo.llamarSiguiente({
    profesionalId: doctor.id,
    moduloId: modulo.id,
    funcionarioId: doctor.id,
    turnoAbiertoEsperado,
  })
}

async function estadoDe(turnoId) {
  return (await repo.historico({ fecha: HOY })).find((t) => t.id === turnoId)
}

// --- Llamar al siguiente --------------------------------------------------------

test('respuesta perdida: el segundo clic no llama a otro ni cierra al primero', async () => {
  const consultorio = await doctorConConsultorio()
  const a = await enEspera(consultorio.doctor.id, '08:00')
  const b = await enEspera(consultorio.doctor.id, '08:15')

  // El servidor llama a A; el cliente nunca se entera.
  await llamarComoDoctor(consultorio, null)

  // El doctor vuelve a pulsar creyendo que no tiene a nadie.
  await assert.rejects(
    () => llamarComoDoctor(consultorio, null),
    (error) => error.status === 409 && error.turnoActual?.id === a.id,
  )

  assert.equal((await estadoDe(a.id)).estado, 'LLAMADO', 'A sigue en atencion, no cerrado por detras')
  assert.equal((await estadoDe(b.id)).estado, 'EN_ESPERA', 'B no se llamo')
})

test('con el turno abierto correcto, llamar al siguiente cierra al anterior', async () => {
  const consultorio = await doctorConConsultorio()
  const a = await enEspera(consultorio.doctor.id, '08:30')
  await enEspera(consultorio.doctor.id, '08:45')

  const llamadoA = await llamarComoDoctor(consultorio, null)
  const llamadoB = await llamarComoDoctor(consultorio, llamadoA.id)

  assert.equal(llamadoB.estado, 'LLAMADO')
  const anterior = await estadoDe(a.id)
  assert.equal(anterior.estado, 'ATENDIDO')
  assert.equal(anterior.cierreAutomatico, true)
})

test('doble clic: la segunda peticion con el mismo estado visto recibe 409, no un segundo llamado', async () => {
  const consultorio = await doctorConConsultorio()
  await enEspera(consultorio.doctor.id, '09:00')
  await enEspera(consultorio.doctor.id, '09:15')

  const [primero, segundo] = await Promise.allSettled([
    llamarComoDoctor(consultorio, null),
    llamarComoDoctor(consultorio, null),
  ])

  assert.equal(primero.status, 'fulfilled')
  assert.equal(segundo.status, 'rejected')
  assert.equal(segundo.reason.status, 409)
  const abiertos = (await repo.historico({ fecha: HOY })).filter(
    (t) => t.profesionalId === consultorio.doctor.id && t.estado === 'LLAMADO',
  )
  assert.equal(abiertos.length, 1, 'un solo paciente llamado')
})

test('el cierre automatico no toca turnos abiertos de dias anteriores', async () => {
  const consultorio = await doctorConConsultorio()
  const deAyer = await enEspera(consultorio.doctor.id, '10:00')
  const llamado = await llamarComoDoctor(consultorio, null)
  assert.equal(llamado.id, deAyer.id)
  // En memoria el dia del turno SALE de `fechaGeneracion`, asi que moverla es
  // moverlo de dia. En PostgreSQL el dia vive en la columna `fecha`: la version
  // de esta prueba para esa base mueve las dos (ver integracion-postgres).
  llamado.fechaGeneracion = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  await enEspera(consultorio.doctor.id, '10:15')
  await llamarComoDoctor(consultorio, null)

  assert.equal(llamado.estado, 'LLAMADO', 'el de ayer no se cierra solo como atendido hoy')
})

// --- Ventanilla (operador) --------------------------------------------------------

async function ventanilla() {
  creados += 1
  const servicio = await repo.crearServicio({
    nombre: `Facturacion ${creados}`,
    prefijo: `F${creados}`,
    modoFila: 'COMPARTIDA',
    activo: true,
  })
  const modulo = await repo.crearModulo({ nombre: `Ventanilla ${creados}`, servicioId: servicio.id, activo: true })
  return { servicio, modulo }
}

test('el operador no puede llamar la fila de un servicio por cita', async () => {
  const { modulo } = await ventanilla()
  await assert.rejects(
    () => repo.llamarSiguiente({ servicioId: 'srv-consulta-externa', moduloId: modulo.id, funcionarioId: 'u1' }),
    /atiende por cita/i,
  )
})

test('el operador no puede llamar desde el consultorio de un medico', async () => {
  const { servicio } = await ventanilla()
  await assert.rejects(
    () => repo.llamarSiguiente({ servicioId: servicio.id, moduloId: 'mod-consultorio-3', funcionarioId: 'u1' }),
    /no pertenece a/i,
  )
})

test('dos operadores en la misma ventanilla: el segundo recibe 409 y no cierra al paciente del primero', async () => {
  const { servicio, modulo } = await ventanilla()
  await repo.generarTurnoDeVentanilla(servicio.id)
  await repo.generarTurnoDeVentanilla(servicio.id)

  const delPrimero = await repo.llamarSiguiente({ servicioId: servicio.id, moduloId: modulo.id, funcionarioId: 'u1' })

  await assert.rejects(
    () => repo.llamarSiguiente({ servicioId: servicio.id, moduloId: modulo.id, funcionarioId: 'u2', turnoAbiertoEsperado: null }),
    (error) => error.status === 409 && /lo esta usando/i.test(error.message),
  )
  assert.equal((await estadoDe(delPrimero.id)).estado, 'LLAMADO')
})

test('el turno abierto de la ventanilla se consulta por el funcionario que lo llamo', async () => {
  const { servicio, modulo } = await ventanilla()
  await repo.generarTurnoDeVentanilla(servicio.id)
  const llamado = await repo.llamarSiguiente({ servicioId: servicio.id, moduloId: modulo.id, funcionarioId: 'u1' })

  assert.equal((await repo.turnoAbierto({ moduloId: modulo.id, funcionarioId: 'u1' }, HOY))?.id, llamado.id)
  assert.equal(await repo.turnoAbierto({ moduloId: modulo.id, funcionarioId: 'u2' }, HOY), null)
})

// --- Cierres --------------------------------------------------------------------

test('"Atendido" repetido tras perderse la respuesta responde exito sin rehacer nada', async () => {
  const consultorio = await doctorConConsultorio()
  await enEspera(consultorio.doctor.id, '11:00')
  const llamado = await llamarComoDoctor(consultorio, null)

  const primero = await repo.marcarAtendido(llamado.id, 'u1')
  const horaAtencion = primero.turno.horaAtencion
  const segundo = await repo.marcarAtendido(llamado.id, 'u1')

  assert.equal(primero.yaAplicada, false)
  assert.equal(segundo.yaAplicada, true)
  assert.equal(segundo.turno.horaAtencion, horaAtencion, 'no se reescribe la hora de atencion')
})

test('"Ausente" sobre un turno ya cerrado como atendido: 409 y turno y cita siguen coherentes', async () => {
  const consultorio = await doctorConConsultorio()
  const a = await enEspera(consultorio.doctor.id, '11:15')
  await enEspera(consultorio.doctor.id, '11:30')
  const llamadoA = await llamarComoDoctor(consultorio, null)
  // El cierre automatico de A ocurre al llamar al siguiente...
  await llamarComoDoctor(consultorio, llamadoA.id)

  // ...y el "ausente" de A llega despues.
  await assert.rejects(() => repo.marcarAusente(a.id, 'u1'), (error) => error.status === 409)

  const turnoA = await estadoDe(a.id)
  const citaA = (await repo.listarCitas({ fecha: HOY })).find((c) => c.id === turnoA.citaId)
  assert.equal(turnoA.estado, 'ATENDIDO')
  assert.equal(citaA.estado, 'ATENDIDA')
})

test('"Repetir" reintentado con el conteo viejo no vuelve a llamar', async () => {
  const consultorio = await doctorConConsultorio()
  await enEspera(consultorio.doctor.id, '11:45')
  const llamado = await llamarComoDoctor(consultorio, null)

  const primero = await repo.repetirLlamado(llamado.id, { vecesLlamadoVisto: 1 })
  const reintento = await repo.repetirLlamado(llamado.id, { vecesLlamadoVisto: 1 })

  assert.equal(primero.yaAplicada, false)
  assert.equal(reintento.yaAplicada, true)
  assert.equal(reintento.turno.vecesLlamado, 2)
})

// --- Llegada ------------------------------------------------------------------------

test('registrar la llegada otra vez devuelve el MISMO turno, marcado como ya registrado', async () => {
  const { doctor } = await doctorConConsultorio()
  const cita = await citaDeHoy(doctor.id, '13:15')

  const primera = await repo.registrarLlegada(cita.id)
  const reintento = await repo.registrarLlegada(cita.id)

  assert.equal(primera.yaRegistrada, false)
  assert.equal(reintento.yaRegistrada, true)
  assert.equal(reintento.turno.id, primera.turno.id)
  assert.equal(reintento.turno.codigo, primera.turno.codigo)
})

test('llegadas simultaneas de dos pacientes reciben codigos distintos', async () => {
  const { doctor } = await doctorConConsultorio()
  const [c1, c2] = [await citaDeHoy(doctor.id, '13:30'), await citaDeHoy(doctor.id, '13:45')]

  const [r1, r2] = await Promise.all([repo.registrarLlegada(c1.id), repo.registrarLlegada(c2.id)])

  assert.notEqual(r1.turno.codigo, r2.turno.codigo)
})

test('la misma cita registrada dos veces a la vez genera un solo turno', async () => {
  const { doctor } = await doctorConConsultorio()
  const cita = await citaDeHoy(doctor.id, '14:00')

  const [r1, r2] = await Promise.all([repo.registrarLlegada(cita.id), repo.registrarLlegada(cita.id)])

  assert.equal(r1.turno.id, r2.turno.id)
  const turnos = (await repo.historico({ fecha: HOY })).filter((t) => t.citaId === cita.id)
  assert.equal(turnos.length, 1)
})

test('la busqueda de admisiones muestra el codigo del turno de las citas ya presentadas', async () => {
  const { doctor } = await doctorConConsultorio()
  const cita = await citaDeHoy(doctor.id, '14:15')
  const { turno } = await repo.registrarLlegada(cita.id)

  const [encontrada] = await repo.buscarCitasPorDocumento(cita.documentoPaciente)

  assert.equal(encontrada.codigoTurno, turno.codigo)
})

// --- Correcciones de QA -------------------------------------------------------

const { realtimeHub } = await import('@/lib/realtime/hub')

test('si el doctor cambio de consultorio, al llamar se libera la casilla del anterior', async () => {
  const consultorio = await doctorConConsultorio()
  const otro = await repo.crearModulo({ nombre: `Consultorio prestado ${creados}`, servicioId: 'srv-consulta-externa', activo: true })
  await enEspera(consultorio.doctor.id, '15:00')
  await enEspera(consultorio.doctor.id, '15:15')
  const primero = await llamarComoDoctor(consultorio, null)

  const eventos = []
  const soltar = realtimeHub.subscribe((evento) => eventos.push(evento))
  try {
    await llamarComoDoctor({ doctor: consultorio.doctor, modulo: otro }, primero.id)
  } finally {
    soltar()
  }

  assert.ok(eventos.some((e) => e.tipo === 'modulo.liberado' && e.moduloId === consultorio.modulo.id))
})

test('el comprobante dice si el turno ya se cerro', async () => {
  const consultorio = await doctorConConsultorio()
  const turno = await enEspera(consultorio.doctor.id, '15:30')
  await llamarComoDoctor(consultorio, null)
  await repo.marcarAusente(turno.id, 'u1')

  const comprobante = await repo.comprobanteDeLlegada(turno.id)

  assert.equal(comprobante.estadoTurno, 'AUSENTE')
})

test('un turno es de la ventanilla solo si es de fila compartida y lo llamo ese funcionario', async () => {
  const { servicio, modulo } = await ventanilla()
  await repo.generarTurnoDeVentanilla(servicio.id)
  const llamado = await repo.llamarSiguiente({ servicioId: servicio.id, moduloId: modulo.id, funcionarioId: 'u1' })
  const consultorio = await doctorConConsultorio()
  const delDoctor = await enEspera(consultorio.doctor.id, '15:45')

  assert.equal(await repo.turnoEsDeLaVentanilla(llamado.id, 'u1'), true)
  assert.equal(await repo.turnoEsDeLaVentanilla(llamado.id, 'u2'), false)
  assert.equal(await repo.turnoEsDeLaVentanilla(delDoctor.id, 'u1'), false)
})

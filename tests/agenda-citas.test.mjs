// Agenda de citas: el operador crea citas y les asigna profesional; el
// administrador fija el tope por profesional (temporal, hasta que llegue la API).
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

function horaHoy(hora, minuto) {
  const d = new Date()
  d.setHours(hora, minuto, 0, 0)
  return d.toISOString()
}

// El estado del repo es compartido (globalThis) y el seed ya trae citas de HOY.
// Para probar el tope sin contaminarnos con esas, agendamos en un dia futuro
// donde no hay citas sembradas.
function horaEnDias(dias, hora, minuto) {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  d.setHours(hora, minuto, 0, 0)
  return d.toISOString()
}

test('crear una cita la deja PROGRAMADA con el servicio del profesional', async () => {
  const repo = new InMemoryTurnoRepository()
  const cita = await repo.crearCita({
    documentoPaciente: '999001',
    nombrePaciente: 'Paciente Prueba Uno',
    profesionalId: 'pro-perez',
    horaCita: horaHoy(9, 0),
  })

  assert.equal(cita.estado, 'PROGRAMADA')
  assert.equal(cita.servicioId, 'srv-consulta-externa')
  assert.equal(cita.documentoPaciente, '999001')
})

test('la cita creada aparece en la agenda y en la busqueda por documento', async () => {
  const repo = new InMemoryTurnoRepository()
  await repo.crearCita({
    documentoPaciente: '999002',
    nombrePaciente: 'Paciente Prueba Dos',
    profesionalId: 'pro-gomez',
    horaCita: horaHoy(10, 0),
  })

  const porDoc = await repo.buscarCitasPorDocumento('999002')
  assert.equal(porDoc.length, 1)

  const agenda = await repo.listarCitas({ profesionalId: 'pro-gomez' })
  assert.ok(agenda.some((c) => c.documentoPaciente === '999002'))
})

test('no se puede agendar a un profesional inexistente', async () => {
  const repo = new InMemoryTurnoRepository()
  await assert.rejects(
    () =>
      repo.crearCita({
        documentoPaciente: '999003',
        nombrePaciente: 'X',
        profesionalId: 'pro-fantasma',
        horaCita: horaHoy(8, 0),
      }),
    /no existe/i,
  )
})

test('el tope de citas por profesional bloquea al pasarse', async () => {
  const repo = new InMemoryTurnoRepository()
  await repo.guardarConfiguracion({ maxCitasPorProfesional: 2 })

  // Dia futuro y profesional sin citas sembradas ese dia.
  const base = { nombrePaciente: 'Paciente', profesionalId: 'pro-salas' }
  await repo.crearCita({ ...base, documentoPaciente: '1', horaCita: horaEnDias(3, 8, 0) })
  await repo.crearCita({ ...base, documentoPaciente: '2', horaCita: horaEnDias(3, 8, 30) })

  await assert.rejects(
    () => repo.crearCita({ ...base, documentoPaciente: '3', horaCita: horaEnDias(3, 9, 0) }),
    /maximo de 2 citas/i,
  )

  // El tope es por dia: otro dia si permite agendar.
  await assert.doesNotReject(() =>
    repo.crearCita({ ...base, documentoPaciente: '4', horaCita: horaEnDias(4, 9, 0) }),
  )

  // Dejar la configuracion como estaba, porque el estado es compartido.
  await repo.guardarConfiguracion({ maxCitasPorProfesional: 20 })
})

test('tope 0 significa sin limite', async () => {
  const repo = new InMemoryTurnoRepository()
  await repo.guardarConfiguracion({ maxCitasPorProfesional: 0 })

  for (let i = 0; i < 5; i++) {
    await repo.crearCita({
      documentoPaciente: `doc-${i}`,
      nombrePaciente: 'Paciente',
      profesionalId: 'pro-rios',
      horaCita: horaHoy(8, i),
    })
  }

  const agenda = await repo.listarCitas({ profesionalId: 'pro-rios' })
  assert.ok(agenda.length >= 5)
})

test('cancelar una cita programada la saca de la agenda', async () => {
  const repo = new InMemoryTurnoRepository()
  const cita = await repo.crearCita({
    documentoPaciente: '999004',
    nombrePaciente: 'Paciente Cuatro',
    profesionalId: 'pro-perez',
    horaCita: horaHoy(11, 0),
  })

  await repo.cancelarCita(cita.id)
  const agenda = await repo.listarCitas({ profesionalId: 'pro-perez' })
  assert.equal(agenda.some((c) => c.id === cita.id), false)
})

test('no se puede cancelar una cita cuyo paciente ya llego', async () => {
  const repo = new InMemoryTurnoRepository()
  const cita = await repo.crearCita({
    documentoPaciente: '999005',
    nombrePaciente: 'Paciente Cinco',
    profesionalId: 'pro-perez',
    horaCita: horaHoy(12, 0),
  })

  await repo.registrarLlegada(cita.id)
  await assert.rejects(() => repo.cancelarCita(cita.id), /ya registro su llegada/i)
})

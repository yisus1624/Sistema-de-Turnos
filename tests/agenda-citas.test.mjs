// Agenda de citas: la cita ocupa un cupo real de la parrilla del doctor.
//
// Desde que la agenda es un horario (jornada de mañana y de tarde, consultas de
// duracion fija), crear una cita deja de ser "guardar una hora cualquiera": la
// hora tiene que ser una franja, el doctor tiene que trabajar esa jornada y el
// cupo tiene que estar libre. Eso es lo que se cuida aqui.
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

const repo = new InMemoryTurnoRepository()

/** Dia AAAA-MM-DD en Colombia, que es como razona la aplicacion. */
function diaColombia(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(fecha)
}

const HOY = diaColombia()

/** Dia futuro, donde no hay citas sembradas y todas las franjas estan libres. */
function enDias(dias) {
  return diaColombia(new Date(Date.now() + dias * 24 * 60 * 60 * 1000))
}

/**
 * Instante de una franja. El desfase de Colombia va a mano (-05:00) porque el
 * equipo de pruebas puede estar en otra zona horaria y la cita caeria en el dia
 * equivocado.
 */
function enFranja(dia, hora) {
  return new Date(`${dia}T${hora}:00-05:00`).toISOString()
}

// La configuracion por defecto: consultas de 15 minutos, mañana 07:00-12:00 y
// tarde 13:00-17:00. Los doctores sembrados reparten las dos jornadas.
const MANANA = '10:00'
const TARDE = '15:00'

test('crear una cita en una franja libre la deja PROGRAMADA con el servicio del profesional', async () => {
  const cita = await repo.crearCita({
    documentoPaciente: '999001',
    nombrePaciente: 'Paciente Prueba Uno',
    profesionalId: 'pro-perez',
    horaCita: enFranja(enDias(2), MANANA),
  })

  assert.equal(cita.estado, 'PROGRAMADA')
  assert.equal(cita.servicioId, 'srv-consulta-externa')
  assert.equal(cita.documentoPaciente, '999001')
})

test('la cita creada aparece en la agenda y en la busqueda por documento de SU dia', async () => {
  const dia = enDias(2)

  await repo.crearCita({
    documentoPaciente: '999002',
    nombrePaciente: 'Paciente Prueba Dos',
    profesionalId: 'pro-gomez',
    horaCita: enFranja(dia, MANANA),
  })

  const porDoc = await repo.buscarCitasPorDocumento('999002', dia)
  assert.equal(porDoc.length, 1)

  const agenda = await repo.listarCitas({ profesionalId: 'pro-gomez' })
  assert.ok(agenda.some((c) => c.documentoPaciente === '999002'))
})

// Admisiones solo puede ofrecer lo que de verdad se puede atender hoy.
//
// La busqueda devolvia las citas de cualquier fecha, y la pantalla las muestra
// solo con la hora: una cita de dentro de dos dias se veia igual que una de hoy
// y se le podia registrar la llegada. El paciente entraba a la fila de un dia
// que no era el suyo, ocupaba un turno real y quemaba su cita.
test('la busqueda de admisiones no ofrece las citas de otros dias', async () => {
  const porDefectoEsHoy = await repo.buscarCitasPorDocumento('999002')
  assert.equal(porDefectoEsHoy.length, 0)

  // Pero se le puede decir al paciente cuando le toca.
  const otras = await repo.otrasCitasDelPaciente('999002')
  assert.equal(otras.length, 1)
  assert.equal(otras[0].nombrePaciente, 'Paciente Prueba Dos')
})

test('registrar la llegada de una cita que no es de hoy se rechaza', async () => {
  const cita = await repo.crearCita({
    documentoPaciente: '999020',
    nombrePaciente: 'Paciente De Otro Dia',
    profesionalId: 'pro-rios',
    horaCita: enFranja(enDias(3), MANANA),
  })

  await assert.rejects(() => repo.registrarLlegada(cita.id), /no es de hoy/i)
})

test('no se puede agendar en un dia que ya paso', async () => {
  await assert.rejects(
    () =>
      repo.crearCita({
        documentoPaciente: '999021',
        nombrePaciente: 'Paciente Del Pasado',
        profesionalId: 'pro-perez',
        horaCita: enFranja(enDias(-3), MANANA),
      }),
    /ya paso/i,
  )
})

test('no se puede agendar a un profesional inexistente', async () => {
  await assert.rejects(
    () =>
      repo.crearCita({
        documentoPaciente: '999003',
        nombrePaciente: 'X',
        profesionalId: 'pro-fantasma',
        horaCita: enFranja(enDias(2), MANANA),
      }),
    /no existe/i,
  )
})

// --- Las tres reglas de la parrilla ---

test('una hora que no cae en ninguna franja se rechaza', async () => {
  // Las 10:07 estan dentro de la mañana, pero no son un cupo: las consultas
  // van cada 15 minutos.
  await assert.rejects(
    () =>
      repo.crearCita({
        documentoPaciente: '999010',
        nombrePaciente: 'Paciente Descuadrado',
        profesionalId: 'pro-perez',
        horaCita: enFranja(enDias(2), '10:07'),
      }),
    /no son una hora de consulta/i,
  )
})

test('a un doctor de la mañana no se le agenda en la tarde', async () => {
  await assert.rejects(
    () =>
      repo.crearCita({
        documentoPaciente: '999011',
        nombrePaciente: 'Paciente Tarde',
        profesionalId: 'pro-perez',
        horaCita: enFranja(enDias(2), TARDE),
      }),
    /atiende en la jornada de la mañana/i,
  )
})

test('a un doctor de la tarde no se le agenda en la mañana', async () => {
  await assert.rejects(
    () =>
      repo.crearCita({
        documentoPaciente: '999012',
        nombrePaciente: 'Paciente Mañana',
        profesionalId: 'pro-torres',
        horaCita: enFranja(enDias(2), MANANA),
      }),
    /atiende en la jornada de la tarde/i,
  )
})

test('un doctor de dia completo acepta las dos jornadas', async () => {
  const dia = enDias(5)

  await assert.doesNotReject(() =>
    repo.crearCita({
      documentoPaciente: '999013',
      nombrePaciente: 'Paciente Mañana',
      profesionalId: 'pro-ramirez',
      horaCita: enFranja(dia, MANANA),
    }),
  )
  await assert.doesNotReject(() =>
    repo.crearCita({
      documentoPaciente: '999014',
      nombrePaciente: 'Paciente Tarde',
      profesionalId: 'pro-ramirez',
      horaCita: enFranja(dia, TARDE),
    }),
  )
})

test('al doctor de mañana se le agenda de tarde el dia que tiene pacientes de tarde', async () => {
  // EL CASO DEL HOSPITAL. Un medico cambia de horario, o su ficha quedo con un
  // veredicto viejo, y ese dia esta atendiendo de tarde: su columna de la
  // tarde esta ahi, llena de pacientes, y el formulario le rechazaba el
  // siguiente porque la ficha decia "mañana". La ficha dice lo HABITUAL; las
  // citas de ese dia suman.
  const dia = enDias(6)
  const doctor = await repo.crearProfesional({
    nombre: 'Dr. Cambio De Turno',
    servicioId: 'srv-consulta-externa',
    jornada: 'COMPLETA',
  })
  await repo.crearCita({
    documentoPaciente: '999015',
    nombrePaciente: 'Primero De La Tarde',
    profesionalId: doctor.id,
    horaCita: enFranja(dia, TARDE),
  })

  // Su ficha pasa a decir "mañana", como la deja una carga de otro dia.
  const enCatalogo = (await repo.listarProfesionales(undefined, true)).find((p) => p.id === doctor.id)
  enCatalogo.jornada = 'MANANA'

  await assert.doesNotReject(
    () =>
      repo.crearCita({
        documentoPaciente: '999016',
        nombrePaciente: 'Segundo De La Tarde',
        profesionalId: doctor.id,
        horaCita: enFranja(dia, '15:30'),
      }),
    'ese dia esta atendiendo de tarde: se le puede seguir agendando de tarde',
  )

  // Pero el dia que NO tiene ni un paciente de tarde, manda su ficha: ahi no
  // hay nada deducido, solo un dia vacio.
  await assert.rejects(
    () =>
      repo.crearCita({
        documentoPaciente: '999017',
        nombrePaciente: 'Paciente De Otro Dia',
        profesionalId: doctor.id,
        horaCita: enFranja(enDias(7), TARDE),
      }),
    /atiende en la jornada de la mañana/i,
  )

  for (const cita of await repo.listarCitas({ profesionalId: doctor.id, fecha: dia })) {
    await repo.cancelarCita(cita.id, { motivo: 'Fin de la prueba' })
  }
  enCatalogo.activo = false
})

test('el mismo cupo no se puede dar dos veces', async () => {
  const dia = enDias(3)
  const base = { nombrePaciente: 'Paciente', profesionalId: 'pro-salas' }

  await repo.crearCita({ ...base, documentoPaciente: '999020', horaCita: enFranja(dia, '09:00') })

  await assert.rejects(
    () => repo.crearCita({ ...base, documentoPaciente: '999021', horaCita: enFranja(dia, '09:00') }),
    /ya tiene un paciente a las 09:00/i,
  )

  // La franja siguiente si esta libre.
  await assert.doesNotReject(() =>
    repo.crearCita({ ...base, documentoPaciente: '999022', horaCita: enFranja(dia, '09:15') }),
  )
})

test('el cupo del dia lo pone la jornada: al llenarla no entra nadie mas', async () => {
  const dia = enDias(6)
  const franjas = []
  for (let minuto = 7 * 60; minuto + 15 <= 12 * 60; minuto += 15) {
    const dosDigitos = (n) => String(n).padStart(2, '0')
    franjas.push(`${dosDigitos(Math.floor(minuto / 60))}:${dosDigitos(minuto % 60)}`)
  }

  for (const [indice, hora] of franjas.entries()) {
    await repo.crearCita({
      documentoPaciente: `lleno-${indice}`,
      nombrePaciente: 'Paciente',
      profesionalId: 'pro-rios',
      horaCita: enFranja(dia, hora),
    })
  }

  const agenda = await repo.listarCitas({ fecha: dia, profesionalId: 'pro-rios' })
  assert.equal(agenda.length, franjas.length, 'la jornada de la mañana da 20 cupos de 15 minutos')

  // Ya no queda ninguna hora suya libre ese dia.
  await assert.rejects(
    () =>
      repo.crearCita({
        documentoPaciente: 'sobra',
        nombrePaciente: 'Paciente',
        profesionalId: 'pro-rios',
        horaCita: enFranja(dia, franjas[0]),
      }),
    /ya tiene un paciente/i,
  )
})

// --- Cancelacion ---

test('cancelar una cita programada la saca de la agenda y libera su cupo', async () => {
  const dia = enDias(4)
  const cita = await repo.crearCita({
    documentoPaciente: '999004',
    nombrePaciente: 'Paciente Cuatro',
    profesionalId: 'pro-perez',
    horaCita: enFranja(dia, '11:00'),
  })

  await repo.cancelarCita(cita.id)

  const agenda = await repo.listarCitas({ profesionalId: 'pro-perez', fecha: dia })
  assert.equal(agenda.some((c) => c.id === cita.id), false)

  // El cupo vuelve a estar disponible para otro paciente.
  await assert.doesNotReject(() =>
    repo.crearCita({
      documentoPaciente: '999005',
      nombrePaciente: 'Paciente Cinco',
      profesionalId: 'pro-perez',
      horaCita: enFranja(dia, '11:00'),
    }),
  )
})

test('no se puede cancelar una cita cuyo paciente ya llego', async () => {
  const cita = await repo.crearCita({
    documentoPaciente: '999006',
    nombrePaciente: 'Paciente Seis',
    profesionalId: 'pro-perez',
    horaCita: enFranja(HOY, '11:30'),
  })

  await repo.registrarLlegada(cita.id)
  await assert.rejects(() => repo.cancelarCita(cita.id), /ya registro su llegada/i)
})

// La aplicacion razona el dia en America/Bogota, pero el equipo donde corre
// puede estar en otra zona. Si las citas sembradas se construyen con la hora
// local del servidor caen en el dia colombiano equivocado y la agenda de "hoy"
// sale vacia (fue lo que dejaba la simulacion de carga en 0 pacientes).
test('las citas sembradas caen en el dia de hoy en Colombia, no en el del servidor', async () => {
  const agenda = await repo.agendaProfesional('pro-perez', HOY)
  assert.ok(
    agenda.length > 0,
    `pro-perez deberia tener citas el ${HOY} (zona del proceso: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
  )
})

test('reiniciarDatosDeHoy deja las citas del dia otra vez en PROGRAMADA', async () => {
  for (const item of await repo.agendaProfesional('pro-gomez', HOY)) {
    if (item.estado === 'PROGRAMADA') await repo.registrarLlegada(item.citaId)
  }
  assert.ok((await repo.listarPendientes({ profesionalId: 'pro-gomez' })).length > 0)

  await repo.reiniciarDatosDeHoy()

  const agenda = await repo.agendaProfesional('pro-gomez', HOY)
  assert.ok(agenda.length > 0)
  assert.ok(agenda.every((item) => item.estado === 'PROGRAMADA'))
  assert.equal((await repo.listarPendientes({ profesionalId: 'pro-gomez' })).length, 0)
})

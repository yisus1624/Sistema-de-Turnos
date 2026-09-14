// El horario del dia: la parrilla de jornada de mañana y jornada de tarde con
// una columna por doctor y una fila por hora.
//
// LAS FILAS NO SON UNA REJILLA FIJA. Salen de las franjas configuradas MAS la
// hora exacta de cada cita del dia, porque la agenda del hospital no va a horas
// redondas: trae citas a las 7:09 y a las 7:13, cada doctor con su propio
// ritmo, y eso no lo decide este sistema. Lo que se cuida aqui es que toda cita
// caiga en la celda de su doctor a su hora de verdad, que ninguna se pierda, y
// que solo se ofrezca agendar a mano donde el servidor lo va a aceptar.
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

const repo = new InMemoryTurnoRepository()

function diaColombia(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(fecha)
}

function enDias(dias) {
  return diaColombia(new Date(Date.now() + dias * 24 * 60 * 60 * 1000))
}

function enFranja(dia, hora) {
  return new Date(`${dia}T${hora}:00-05:00`).toISOString()
}

const bloqueDe = (horario, jornada) => horario.bloques.find((b) => b.jornada === jornada)
const columna = (bloque, profesionalId) => bloque.columnas.find((c) => c.profesionalId === profesionalId)

test('un dia sin citas ensena las franjas de la configuracion: 15 minutos, de 7 a 12', async () => {
  const horario = await repo.horarioDelDia(enDias(10))

  assert.equal(horario.duracionCitaMinutos, 15)

  const manana = bloqueDe(horario, 'MANANA')
  assert.equal(manana.desde, '07:00')
  assert.equal(manana.hasta, '12:00')
  assert.equal(manana.filas.length, 20)
  assert.equal(manana.filas[0].hora, '07:00')

  // La ultima consulta tiene que CABER antes del cierre: con 15 minutos, la
  // ultima entra a las 11:45 y no a las 11:55.
  assert.equal(manana.filas.at(-1).hora, '11:45')

  // Todas son franjas de la configuracion, asi que en todas se puede agendar.
  assert.ok(manana.filas.every((f) => f.agendable))

  const tarde = bloqueDe(horario, 'TARDE')
  assert.equal(tarde.filas.length, 16)
  assert.equal(tarde.filas.at(-1).hora, '16:45')
})

test('cada doctor aparece solo en la jornada que trabaja; el de dia completo, en las dos', async () => {
  const horario = await repo.horarioDelDia(enDias(10))
  const manana = bloqueDe(horario, 'MANANA')
  const tarde = bloqueDe(horario, 'TARDE')

  assert.ok(columna(manana, 'pro-perez'), 'Dr. Perez atiende en la mañana')
  assert.equal(columna(tarde, 'pro-perez'), undefined)

  assert.ok(columna(tarde, 'pro-torres'), 'Dr. Torres atiende en la tarde')
  assert.equal(columna(manana, 'pro-torres'), undefined)

  assert.ok(columna(manana, 'pro-ramirez'), 'Dr. Ramirez atiende el dia completo')
  assert.ok(columna(tarde, 'pro-ramirez'))
})

test('las ventanillas no salen en el horario: su fila es por orden de llegada', async () => {
  const horario = await repo.horarioDelDia(enDias(10))

  for (const bloque of horario.bloques) {
    for (const col of bloque.columnas) {
      assert.notEqual(col.servicioNombre, 'Admisiones')
      assert.notEqual(col.servicioNombre, 'Facturacion')
    }
  }
})

test('la cita agendada cae en la celda de su doctor y su hora', async () => {
  const dia = enDias(11)
  await repo.crearCita({
    documentoPaciente: '777001',
    nombrePaciente: 'Paciente En Celda',
    profesionalId: 'pro-perez',
    horaCita: enFranja(dia, '09:30'),
  })

  const manana = bloqueDe(await repo.horarioDelDia(dia), 'MANANA')
  const celda = manana.citas['pro-perez|09:30']

  assert.ok(celda, 'la cita deberia estar en la celda pro-perez / 09:30')
  assert.equal(celda.length, 1)
  assert.equal(celda[0].nombrePaciente, 'Paciente En Celda')
  assert.equal(celda[0].estado, 'PROGRAMADA')
  assert.equal(celda[0].hora, '09:30')
})

test('la columna del doctor cuenta sus citas', async () => {
  const dia = enDias(12)
  for (const hora of ['07:00', '07:15', '07:30']) {
    await repo.crearCita({
      documentoPaciente: `777${hora.replace(':', '')}`,
      nombrePaciente: 'Paciente',
      profesionalId: 'pro-gomez',
      horaCita: enFranja(dia, hora),
    })
  }

  const manana = bloqueDe(await repo.horarioDelDia(dia), 'MANANA')
  const col = columna(manana, 'pro-gomez')

  // Cuantas citas tiene, y nada de "3 de 20": esos 20 salian de partir la
  // jornada entre la duracion de la consulta, y no son cupos que este doctor
  // tenga. Su agenda la arma el hospital, con el ritmo que cada uno lleve.
  assert.equal(col.citas, 3)
  assert.equal(col.cupos, undefined)
})

test('la cita cancelada libera la celda', async () => {
  const dia = enDias(13)
  const cita = await repo.crearCita({
    documentoPaciente: '777002',
    nombrePaciente: 'Paciente Que Cancela',
    profesionalId: 'pro-salas',
    horaCita: enFranja(dia, '08:00'),
  })

  await repo.cancelarCita(cita.id)

  const manana = bloqueDe(await repo.horarioDelDia(dia), 'MANANA')
  assert.equal(manana.citas['pro-salas|08:00'], undefined)
  assert.equal(
    manana.fueraDeHorario,
    undefined,
    'una cancelada no es una cita fuera de horario: simplemente ya no esta',
  )
})

// --- Quien atiende hoy y quien no ---
//
// La pantalla esconde las columnas de los doctores que hoy no tienen ni un
// paciente, porque el catalogo lo llena la carga diaria y crece, pero en un dia
// cualquiera atiende una parte. Para poder esconderlas sin esconder a quien si
// atiende, la columna tiene que decir cuantas citas trae en esa jornada.

test('la columna dice cuantas citas trae el doctor en esa jornada', async () => {
  const dia = enDias(21)
  for (const hora of ['08:00', '08:15']) {
    await repo.crearCita({
      documentoPaciente: `881${hora.replace(':', '')}`,
      nombrePaciente: 'Paciente De La Mañana',
      profesionalId: 'pro-ramirez',
      horaCita: enFranja(dia, hora),
    })
  }

  const horario = await repo.horarioDelDia(dia)

  assert.equal(columna(bloqueDe(horario, 'MANANA'), 'pro-ramirez').citas, 2)
  // El mismo doctor (dia completo) no tiene nada por la tarde: esa columna es
  // la que la pantalla esconde.
  assert.equal(columna(bloqueDe(horario, 'TARDE'), 'pro-ramirez').citas, 0)
})

test('un doctor sin ninguna cita ese dia trae cero, aunque atienda la jornada', async () => {
  const horario = await repo.horarioDelDia(enDias(22))

  for (const bloque of horario.bloques) {
    for (const col of bloque.columnas) {
      assert.equal(col.citas, 0, `${col.profesionalNombre} no deberia traer citas ese dia`)
    }
  }
})

test('la cita a una hora que no es franja se abre su propia fila, y no se expulsa', async () => {
  // ESTE ES EL CASO REAL DEL HOSPITAL. Su agenda trae citas a las 7:09 y a las
  // 7:13: con una rejilla fija, esos pacientes se iban a una lista al pie y la
  // columna de su doctor quedaba en blanco, igual que la de uno que no vino.
  // Aqui se reproduce descuadrando las franjas, que es la unica forma de
  // conseguirlo por la puerta de delante.
  const dia = enDias(23)
  await repo.crearCita({
    documentoPaciente: '882001',
    nombrePaciente: 'Paciente A Hora Suelta',
    profesionalId: 'pro-perez',
    horaCita: enFranja(dia, '08:15'),
  })

  await repo.guardarConfiguracion({ duracionCitaMinutos: 20 })
  try {
    const horario = await repo.horarioDelDia(dia)
    const manana = bloqueDe(horario, 'MANANA')

    // Con 20 minutos las franjas son 07:00, 07:20, 07:40, 08:00, 08:20... Las
    // 08:15 no son franja, pero hay un paciente citado, asi que hay fila.
    const fila = manana.filas.find((f) => f.hora === '08:15')
    assert.ok(fila, 'la hora de la cita tiene que tener su fila')
    assert.equal(fila.agendable, false, 'pero no se ofrece agendar a mano en ella')

    assert.equal(manana.citas['pro-perez|08:15'][0].nombrePaciente, 'Paciente A Hora Suelta')
    assert.equal(columna(manana, 'pro-perez').citas, 1)
    assert.equal(horario.fueraDeHorario.length, 0, 'ya no se expulsa a nadie de la parrilla')
  } finally {
    await repo.guardarConfiguracion({ duracionCitaMinutos: 15 })
  }
})

test('dos pacientes con el mismo doctor a la misma hora se ven los dos', async () => {
  // El hospital lo hace. Guardando uno solo en la celda, el otro desaparece de
  // la agenda sin que nadie se entere, y aun asi se presenta en la ventanilla.
  const dia = enDias(24)
  const doctor = await repo.crearProfesional({
    nombre: 'Dr. Doble Cita',
    servicioId: 'srv-consulta-externa',
    jornada: 'MANANA',
  })

  for (const [documento, nombre, hora] of [
    ['883001', 'Primero De Las Nueve', '09:00'],
    ['883002', 'Segundo De Las Nueve', '09:15'],
  ]) {
    await repo.crearCita({ documentoPaciente: documento, nombrePaciente: nombre, profesionalId: doctor.id, horaCita: enFranja(dia, hora) })
  }

  // Agendar a mano encima de un cupo ocupado lo impide el dominio, y asi tiene
  // que seguir. La coincidencia solo puede entrar por la carga del hospital,
  // que guarda la hora tal cual: se reproduce moviendo la segunda a las 09:00.
  const citas = await repo.listarCitas({ profesionalId: doctor.id, fecha: dia })
  citas.find((c) => c.documentoPaciente === '883002').horaCita = enFranja(dia, '09:00')

  const manana = bloqueDe(await repo.horarioDelDia(dia), 'MANANA')
  const celda = manana.citas[`${doctor.id}|09:00`]

  assert.equal(celda.length, 2, 'las dos citas tienen que estar en la celda')
  assert.deepEqual(
    celda.map((c) => c.nombrePaciente).sort(),
    ['Primero De Las Nueve', 'Segundo De Las Nueve'],
  )
  assert.equal(columna(manana, doctor.id).citas, 2)

  // Se limpia: el estado del archivo es compartido.
  for (const cita of await repo.listarCitas({ profesionalId: doctor.id, fecha: dia })) {
    await repo.cancelarCita(cita.id, { motivo: 'Fin de la prueba' })
  }
  await repo.actualizarProfesional(doctor.id, { activo: false })
})

// --- Lo que NO se puede perder ---

test('cambiar la duracion de la consulta no descoloca a los que ya estaban citados', async () => {
  const dia = enDias(14)
  await repo.crearCita({
    documentoPaciente: '777003',
    nombrePaciente: 'Paciente Descuadrado',
    profesionalId: 'pro-perez',
    horaCita: enFranja(dia, '08:15'),
  })

  // Con consultas de 20 minutos las franjas pasan a 07:00, 07:20, 07:40,
  // 08:00, 08:20... y las 08:15 dejan de ser hora de agendar.
  await repo.guardarConfiguracion({ duracionCitaMinutos: 20 })
  try {
    const horario = await repo.horarioDelDia(dia)
    const manana = bloqueDe(horario, 'MANANA')

    // El paciente sigue donde su cita dice, con su hora intacta. Cambiar una
    // opcion de la configuracion no puede mover a nadie de hora ni sacarlo de
    // la agenda: al paciente ya le dijeron a que hora venir.
    assert.equal(manana.citas['pro-perez|08:15'][0].nombrePaciente, 'Paciente Descuadrado')
    assert.equal(manana.filas.find((f) => f.hora === '08:15').agendable, false)
    assert.equal(horario.fueraDeHorario.length, 0)
  } finally {
    // El estado es compartido entre las pruebas del archivo.
    await repo.guardarConfiguracion({ duracionCitaMinutos: 15 })
  }
})

test('las citas de un doctor desactivado tampoco se pierden', async () => {
  const dia = enDias(15)
  const doctor = await repo.crearProfesional({
    nombre: 'Dr. De Paso',
    servicioId: 'srv-consulta-externa',
    jornada: 'MANANA',
  })
  await repo.crearCita({
    documentoPaciente: '777004',
    nombrePaciente: 'Paciente Huerfano',
    profesionalId: doctor.id,
    horaCita: enFranja(dia, '10:00'),
  })

  // Se le da de baja SIN pasar por `actualizarProfesional`, que ahora lo
  // impide justamente para que no queden pacientes colgados. Lo que se prueba
  // aqui es la red de seguridad para cuando ese estado llega igual: por datos
  // viejos, o porque la agenda del hospital devuelva una cita de un doctor que
  // ya dio de baja. Si pasa, su paciente tiene que seguir a la vista.
  const enCatalogo = (await repo.listarProfesionales(undefined, true)).find((p) => p.id === doctor.id)
  enCatalogo.activo = false

  const horario = await repo.horarioDelDia(dia)
  assert.equal(columna(bloqueDe(horario, 'MANANA'), doctor.id), undefined, 'ya no tiene columna')
  assert.ok(
    horario.fueraDeHorario.some((c) => c.nombrePaciente === 'Paciente Huerfano'),
    'pero su paciente sigue a la vista',
  )
})

// --- Configuracion coherente ---

test('no se puede guardar una jornada que termina antes de empezar', async () => {
  await assert.rejects(
    () => repo.guardarConfiguracion({ jornadaMananaInicio: '12:00', jornadaMananaFin: '07:00' }),
    /terminar despues de empezar/i,
  )
})

test('no se puede guardar una jornada donde no cabe ni una consulta', async () => {
  await assert.rejects(
    () => repo.guardarConfiguracion({ jornadaTardeInicio: '13:00', jornadaTardeFin: '13:05' }),
    /no cabe ni una consulta/i,
  )
})

test('la tarde no puede empezar antes de que cierre la mañana', async () => {
  await assert.rejects(
    () => repo.guardarConfiguracion({ jornadaTardeInicio: '11:00' }),
    /antes de que termine la de la mañana/i,
  )
})

test('una configuracion rechazada no deja la configuracion a medias', async () => {
  const antes = await repo.configuracion()

  await assert.rejects(() =>
    repo.guardarConfiguracion({ jornadaMananaInicio: '06:00', jornadaMananaFin: '05:00' }),
  )

  const despues = await repo.configuracion()
  assert.deepEqual(despues, antes, 'se guardan las cuatro horas juntas o ninguna')
})

test('cambiar la duracion de la consulta cambia los cupos del dia', async () => {
  await repo.guardarConfiguracion({ duracionCitaMinutos: 30 })
  try {
    const manana = bloqueDe(await repo.horarioDelDia(enDias(16)), 'MANANA')
    assert.equal(manana.filas.length, 10, 'de 7 a 12, consultas de 30 minutos dan 10 franjas')
    assert.ok(manana.filas.every((f) => f.agendable))
  } finally {
    await repo.guardarConfiguracion({ duracionCitaMinutos: 15 })
  }
})

// --- Que aguante el hospital completo ---

test('la parrilla sostiene muchos doctores sin mezclar las celdas', async () => {
  const dia = enDias(20)
  const creados = []

  // Veinte doctores en la misma jornada, que es el escenario que preocupa:
  // todos comparten las mismas franjas y sus columnas van una al lado de otra.
  for (let i = 0; i < 20; i += 1) {
    creados.push(
      await repo.crearProfesional({
        nombre: `Dr. Numero ${String(i).padStart(2, '0')}`,
        servicioId: 'srv-consulta-externa',
        jornada: 'MANANA',
      }),
    )
  }

  // A cada uno una cita a una hora distinta, para poder comprobar despues que
  // ninguna se fue a la columna del vecino.
  const horas = ['07:00', '07:15', '07:30', '07:45', '08:00']
  for (const [i, doctor] of creados.entries()) {
    await repo.crearCita({
      documentoPaciente: `carga-${i}`,
      nombrePaciente: `Paciente De ${doctor.nombre}`,
      profesionalId: doctor.id,
      horaCita: enFranja(dia, horas[i % horas.length]),
    })
  }

  const manana = bloqueDe(await repo.horarioDelDia(dia), 'MANANA')

  assert.ok(manana.columnas.length >= 20, `esperaba 20+ columnas, hubo ${manana.columnas.length}`)

  // Ninguna columna repetida: la pantalla las usa como clave de React y dos
  // iguales harian que una tapara a la otra.
  const ids = manana.columnas.map((c) => c.profesionalId)
  assert.equal(new Set(ids).size, ids.length)

  // Cada cita en la celda de SU doctor y solo ahi.
  for (const [i, doctor] of creados.entries()) {
    const celda = manana.citas[`${doctor.id}|${horas[i % horas.length]}`]
    assert.ok(celda, `falta la cita de ${doctor.nombre}`)
    assert.equal(celda[0].nombrePaciente, `Paciente De ${doctor.nombre}`)
    assert.equal(columna(manana, doctor.id).citas, 1)
  }

  // Se dejan inactivos: el estado del archivo es compartido y 20 columnas de
  // relleno estorbarian a las demas pruebas. Primero se cancelan sus citas,
  // porque dar de baja a un doctor con pacientes citados esta prohibido: esos
  // pacientes se quedarian en una fila que nadie puede llamar.
  for (const doctor of creados) {
    for (const cita of await repo.listarCitas({ profesionalId: doctor.id, fecha: dia })) {
      await repo.cancelarCita(cita.id, { motivo: 'Fin de la prueba de carga' })
    }
    await repo.actualizarProfesional(doctor.id, { activo: false })
  }
})

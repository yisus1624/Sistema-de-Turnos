// El horario del dia: la parrilla de jornada de mañana y jornada de tarde con
// una columna por doctor y una fila por franja.
//
// Es la vista con la que se trabaja la agenda, asi que lo que se cuida aqui es
// que las franjas salgan de la configuracion, que cada doctor aparezca solo en
// la jornada que trabaja, y sobre todo que ninguna cita se pierda: las que no
// encajan en la parrilla tienen que salir aparte y no desaparecer.
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

test('la parrilla sale de la configuracion: 15 minutos dan 20 cupos de 7 a 12', async () => {
  const horario = await repo.horarioDelDia(enDias(10))

  assert.equal(horario.duracionCitaMinutos, 15)

  const manana = bloqueDe(horario, 'MANANA')
  assert.equal(manana.desde, '07:00')
  assert.equal(manana.hasta, '12:00')
  assert.equal(manana.horas.length, 20)
  assert.equal(manana.horas[0], '07:00')

  // La ultima consulta tiene que CABER antes del cierre: con 15 minutos, la
  // ultima entra a las 11:45 y no a las 11:55.
  assert.equal(manana.horas.at(-1), '11:45')

  const tarde = bloqueDe(horario, 'TARDE')
  assert.equal(tarde.horas.length, 16)
  assert.equal(tarde.horas.at(-1), '16:45')
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
  assert.equal(celda.nombrePaciente, 'Paciente En Celda')
  assert.equal(celda.estado, 'PROGRAMADA')
  assert.equal(celda.hora, '09:30')
})

test('la columna del doctor cuenta sus cupos ocupados', async () => {
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

  assert.equal(col.ocupados, 3)
  assert.equal(col.cupos, 20)
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

// --- Lo que NO se puede perder ---

test('al cambiar la duracion de la consulta, las citas descuadradas salen aparte y no desaparecen', async () => {
  const dia = enDias(14)
  await repo.crearCita({
    documentoPaciente: '777003',
    nombrePaciente: 'Paciente Descuadrado',
    profesionalId: 'pro-perez',
    horaCita: enFranja(dia, '08:15'),
  })

  // Con consultas de 20 minutos las franjas pasan a 07:00, 07:20, 07:40,
  // 08:00, 08:20... y las 08:15 dejan de existir.
  await repo.guardarConfiguracion({ duracionCitaMinutos: 20 })
  try {
    const horario = await repo.horarioDelDia(dia)

    assert.equal(bloqueDe(horario, 'MANANA').citas['pro-perez|08:15'], undefined)
    assert.equal(horario.fueraDeHorario.length, 1)
    assert.equal(horario.fueraDeHorario[0].nombrePaciente, 'Paciente Descuadrado')
    assert.equal(horario.fueraDeHorario[0].hora, '08:15')
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
    assert.equal(manana.horas.length, 10, 'de 7 a 12, consultas de 30 minutos dan 10 cupos')
    assert.equal(columna(manana, 'pro-perez').cupos, 10)
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
    assert.equal(celda.nombrePaciente, `Paciente De ${doctor.nombre}`)
    assert.equal(columna(manana, doctor.id).ocupados, 1)
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

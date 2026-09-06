// Catalogo que el administrador mantiene a mano mientras no exista la API del
// hospital: alta de doctores y borrado de servicios (requerimiento seccion 15).
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

const repo = new InMemoryTurnoRepository()

/** Servicio recien creado, sin turnos ni citas: el unico que se puede borrar. */
async function servicioNuevo(nombre, prefijo, modoFila = 'COMPARTIDA') {
  return repo.crearServicio({ nombre, prefijo, modoFila, activo: true })
}

// --------------------------------------------------------------- eliminar

test('un servicio que nunca opero se puede eliminar', async () => {
  const servicio = await servicioNuevo('Vacunacion', 'VA')

  await repo.eliminarServicio(servicio.id)

  const servicios = await repo.listarServicios()
  assert.equal(
    servicios.some((s) => s.id === servicio.id),
    false,
  )
})

test('al eliminar el servicio, sus consultorios quedan sin asignar pero no se borran', async () => {
  const servicio = await servicioNuevo('Terapia fisica', 'TF')
  const modulo = await repo.crearModulo({ nombre: 'Sala de terapia', servicioId: servicio.id, activo: true })

  await repo.eliminarServicio(servicio.id)

  const modulos = await repo.listarModulos()
  const encontrado = modulos.find((m) => m.id === modulo.id)
  assert.ok(encontrado, 'el consultorio no se debe borrar con el servicio')
  assert.equal(encontrado.servicioId, null)
})

test('un servicio con turnos NO se elimina: el historico quedaria roto', async () => {
  const servicio = await servicioNuevo('Entrega de medicamentos', 'EM')
  await repo.generarTurnoDeVentanilla(servicio.id)

  await assert.rejects(() => repo.eliminarServicio(servicio.id), /turnos registrados/i)

  // Sigue en el catalogo, para poder desactivarlo en su lugar.
  const servicios = await repo.listarServicios()
  assert.ok(servicios.some((s) => s.id === servicio.id))
})

test('un servicio con profesionales asignados NO se elimina', async () => {
  const servicio = await servicioNuevo('Nutricion', 'NU', 'POR_PROFESIONAL')
  await repo.crearProfesional({ nombre: 'Dra. Nutricionista', servicioId: servicio.id, jornada: 'MANANA' })

  await assert.rejects(() => repo.eliminarServicio(servicio.id), /profesional/i)
})

test('un servicio con citas agendadas NO se elimina', async () => {
  // Consulta externa viene sembrada con las citas de hoy.
  await assert.rejects(() => repo.eliminarServicio('srv-consulta-externa'), /citas/i)
})

// ------------------------------------------------------------- profesionales

test('el doctor creado queda disponible para agendarle citas', async () => {
  const doctor = await repo.crearProfesional({
    nombre: '  Dr. Nuevo Ingreso  ',
    servicioId: 'srv-consulta-externa',
    jornada: 'TARDE',
    moduloId: 'mod-consultorio-1',
  })

  assert.match(doctor.id, /^pro-/)
  assert.equal(doctor.nombre, 'Dr. Nuevo Ingreso', 'el nombre se guarda sin espacios sobrantes')
  assert.equal(doctor.jornada, 'TARDE')
  assert.equal(doctor.activo, true)

  const enConsultaExterna = await repo.listarProfesionales('srv-consulta-externa')
  assert.ok(enConsultaExterna.some((p) => p.id === doctor.id))
})

test('no se puede crear un doctor en un servicio de ventanilla', async () => {
  // Un servicio de fila compartida se atiende por orden de llegada: un doctor
  // asignado ahi no tendria pacientes propios a quien llamar.
  const ventanilla = await servicioNuevo('Caja', 'CJ', 'COMPARTIDA')

  await assert.rejects(
    () => repo.crearProfesional({ nombre: 'Dr. Imposible', servicioId: ventanilla.id, jornada: 'MANANA' }),
    /ventanilla/i,
  )
})

test('un doctor no se borra: se desactiva y desaparece de la agenda', async () => {
  const doctor = await repo.crearProfesional({
    nombre: 'Dr. Temporal',
    servicioId: 'srv-consulta-externa',
    jornada: 'MANANA',
  })

  await repo.actualizarProfesional(doctor.id, { activo: false })

  const activos = await repo.listarProfesionales()
  assert.equal(
    activos.some((p) => p.id === doctor.id),
    false,
    'un doctor inactivo no se le puede agendar',
  )

  // Pero la administracion si lo ve, para poder reactivarlo.
  const todos = await repo.listarProfesionales(undefined, true)
  assert.ok(todos.some((p) => p.id === doctor.id))
})

test('no se le cambia el servicio a un doctor que tiene citas programadas', async () => {
  // pro-perez viene sembrado con citas de hoy en consulta externa. Mover a un
  // doctor de servicio cambia la fila en la que caen sus pacientes, asi que no
  // se hace por encima de una agenda ya armada.
  const otro = await servicioNuevo('Salud oral', 'SO', 'POR_PROFESIONAL')

  await assert.rejects(
    () => repo.actualizarProfesional('pro-perez', { servicioId: otro.id }),
    /citas programadas/i,
  )
})

test('no se le cambia la jornada a un doctor que dejaria pacientes fuera de horario', async () => {
  // pro-perez atiende en la mañana y tiene citas sembradas de hoy: pasarlo a la
  // tarde dejaria a esos pacientes en horas que su nueva jornada no cubre.
  await assert.rejects(
    () => repo.actualizarProfesional('pro-perez', { jornada: 'TARDE' }),
    /quedarian fuera de la jornada de la tarde/i,
  )
})

test('ampliar a dia completo si se puede: no saca a nadie de su hora', async () => {
  const doctor = await repo.actualizarProfesional('pro-gomez', { jornada: 'COMPLETA' })
  assert.equal(doctor.jornada, 'COMPLETA')

  // Se deja como estaba, que el estado del archivo es compartido.
  await repo.actualizarProfesional('pro-gomez', { jornada: 'MANANA' })
})

test('se le puede cambiar el consultorio a un doctor sin tocar sus citas', async () => {
  const actualizado = await repo.actualizarProfesional('pro-perez', { moduloId: 'mod-consultorio-5' })
  assert.equal(actualizado.moduloId, 'mod-consultorio-5')

  const sinConsultorio = await repo.actualizarProfesional('pro-perez', { moduloId: null })
  assert.equal(sinConsultorio.moduloId, null)
})

test('no se da de baja a un doctor con pacientes citados o sin cerrar', async () => {
  const servicio = await repo.crearServicio({
    nombre: 'Especialidad de baja',
    prefijo: 'ZC',
    modoFila: 'POR_PROFESIONAL',
    activo: true,
  })
  const doctora = await repo.crearProfesional({
    nombre: 'Dra. Se Va',
    servicioId: servicio.id,
    jornada: 'COMPLETA',
    moduloId: null,
  })

  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
  const { jornadaMananaInicio } = await repo.configuracion()
  await repo.crearCita({
    documentoPaciente: '99887766',
    nombrePaciente: 'Paciente Citado',
    profesionalId: doctora.id,
    horaCita: new Date(`${hoy}T${jornadaMananaInicio}:00-05:00`).toISOString(),
  })

  // Al darla de baja su enlace deja de servir en el acto: ese paciente entraria
  // a la fila de alguien que ya no puede llamar a nadie.
  await assert.rejects(
    () => repo.actualizarProfesional(doctora.id, { activo: false }),
    /cita\(s\) programada\(s\)/i,
  )

  // Resuelta la agenda, la baja si procede.
  const citas = await repo.listarCitas({ profesionalId: doctora.id, fecha: hoy })
  for (const cita of citas) await repo.cancelarCita(cita.id, { motivo: 'Prueba' })

  const dada = await repo.actualizarProfesional(doctora.id, { activo: false })
  assert.equal(dada.activo, false)
})

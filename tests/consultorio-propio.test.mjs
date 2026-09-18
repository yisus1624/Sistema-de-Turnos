// Cada doctor llama en SU consultorio.
//
// El `moduloId` viaja en el cuerpo de la peticion y no se contrastaba con quien
// la mandaba, asi que un id equivocado bastaba para llamar en la puerta de
// otro. Y no era solo un numero mal puesto en la pantalla: al llamar, el
// sistema da por ATENDIDO al paciente que ese consultorio tuviera adentro, asi
// que un doctor le cerraba la atencion a otro sin que se enterara ninguno de
// los dos. Llegaba solo por la interfaz: un doctor sin consultorio asignado
// caia en el primero de su servicio.
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

const repo = new InMemoryTurnoRepository()

function diaColombia(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(fecha)
}

const HOY = diaColombia()

/** Un doctor nuevo con su propio consultorio, para no heredar filas ajenas. */
let creados = 0
async function doctorConConsultorio(jornada = 'COMPLETA') {
  creados += 1
  const modulo = await repo.crearModulo({
    nombre: `Consultorio de prueba ${creados}`,
    servicioId: 'srv-consulta-externa',
    activo: true,
  })
  const doctor = await repo.crearProfesional({
    nombre: `Dr. Prueba ${creados}`,
    servicioId: 'srv-consulta-externa',
    jornada,
    moduloId: modulo.id,
  })
  return { doctor, modulo }
}

/** Deja un paciente esperando en la fila de ese doctor. */
let documentos = 800000
async function pacienteEnEspera(profesionalId, hora) {
  documentos += 1
  const cita = await repo.crearCita({
    documentoPaciente: String(documentos),
    nombrePaciente: `Paciente ${documentos}`,
    profesionalId,
    horaCita: new Date(`${HOY}T${hora}:00-05:00`).toISOString(),
  })
  return repo.registrarLlegada(cita.id)
}

test('un doctor no puede llamar desde el consultorio de otro servicio', async () => {
  const { doctor } = await doctorConConsultorio()
  await pacienteEnEspera(doctor.id, '10:00')

  await assert.rejects(
    () =>
      repo.llamarSiguiente({
        profesionalId: doctor.id,
        // Consultorio de odontologia.
        moduloId: 'mod-consultorio-9',
        funcionarioId: doctor.id,
      }),
    /no pertenece a/i,
  )
})

test('un doctor no puede llamar en un consultorio ocupado por otro doctor', async () => {
  const a = await doctorConConsultorio()
  const b = await doctorConConsultorio()

  await pacienteEnEspera(a.doctor.id, '10:15')
  await pacienteEnEspera(b.doctor.id, '10:15')

  const llamadoDeA = await repo.llamarSiguiente({
    profesionalId: a.doctor.id,
    moduloId: a.modulo.id,
    funcionarioId: a.doctor.id,
  })
  assert.equal(llamadoDeA.estado, 'LLAMADO')

  await assert.rejects(
    () =>
      repo.llamarSiguiente({
        profesionalId: b.doctor.id,
        moduloId: a.modulo.id,
        funcionarioId: b.doctor.id,
      }),
    /lo esta usando/i,
  )

  // Y lo que de verdad importa: el paciente de A sigue en atencion, no cerrado.
  const historico = await repo.historico({ profesionalId: a.doctor.id, fecha: HOY })
  const suyo = historico.find((t) => t.id === llamadoDeA.id)
  assert.equal(suyo.estado, 'LLAMADO', 'a nadie se le cierra el paciente por detras')
  assert.equal(suyo.horaAtencion ?? null, null)
})

test('no se puede llamar desde un consultorio desactivado', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  await pacienteEnEspera(doctor.id, '10:30')
  await repo.actualizarModulo(modulo.id, { activo: false })

  await assert.rejects(
    () =>
      repo.llamarSiguiente({
        profesionalId: doctor.id,
        moduloId: modulo.id,
        funcionarioId: doctor.id,
      }),
    /desactivado/i,
  )
})

test('llamar en el consultorio propio si cierra al paciente anterior', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  const primero = await pacienteEnEspera(doctor.id, '10:45')
  await pacienteEnEspera(doctor.id, '11:00')

  await repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: doctor.id })
  await repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: doctor.id })

  const historico = await repo.historico({ profesionalId: doctor.id, fecha: HOY })
  const anterior = historico.find((t) => t.id === primero.id)
  assert.equal(anterior.estado, 'ATENDIDO', 'pasar al siguiente cierra al anterior del MISMO doctor')
})

// Un turno que quedo abierto AYER no puede bloquear el consultorio hoy.
//
// Los turnos se quedan en LLAMADO hasta que alguien los cierra, y al final de
// la jornada es normal que el ultimo quede asi: el doctor termina y se va. Si
// el bloqueo de "consultorio ocupado" no mirara el dia, ese turno colgado
// dejaria la puerta inutilizable para siempre.
test('un turno sin cerrar de un dia anterior no bloquea el consultorio', async () => {
  const a = await doctorConConsultorio()
  const b = await doctorConConsultorio()

  await pacienteEnEspera(a.doctor.id, '11:15')
  const llamado = await repo.llamarSiguiente({
    profesionalId: a.doctor.id,
    moduloId: a.modulo.id,
    funcionarioId: a.doctor.id,
  })

  // Se simula que ese llamado fue ayer y nadie lo cerro.
  const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const enMemoria = (await repo.historico({ profesionalId: a.doctor.id })).find((t) => t.id === llamado.id)
  enMemoria.horaLlamado = ayer

  // Otro doctor toma ese consultorio hoy: tiene que poder.
  await pacienteEnEspera(b.doctor.id, '11:30')
  const deHoy = await repo.llamarSiguiente({
    profesionalId: b.doctor.id,
    moduloId: a.modulo.id,
    funcionarioId: b.doctor.id,
  })

  assert.equal(deHoy.estado, 'LLAMADO')
  assert.equal(deHoy.moduloId, a.modulo.id)
})

// Un consultorio no se apaga con un paciente adentro.
//
// Apagarlo borra su casilla del televisor, y la borra CON el turno ya llamado
// pintado ahi: el paciente se queda mirando una pantalla donde su numero acaba
// de desaparecer, sin saber por que puerta entrar. Y al doctor se le bloquea el
// llamado desde ese consultorio, asi que tampoco puede cerrar al que tiene
// enfrente.
test('no se puede desactivar un consultorio con un turno en atencion', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  await pacienteEnEspera(doctor.id, '09:00')
  await repo.llamarSiguiente({
    profesionalId: doctor.id,
    moduloId: modulo.id,
    funcionarioId: 'usuario-prueba',
  })

  await assert.rejects(
    () => repo.actualizarModulo(modulo.id, { activo: false }),
    /esta siendo atendido/i,
  )

  // Y en cuanto el doctor lo cierra, ya se puede apagar.
  const enAtencion = await repo.turnoEnAtencion(doctor.id, HOY)
  await repo.marcarAtendido(enAtencion.id, 'usuario-prueba')

  const apagado = await repo.actualizarModulo(modulo.id, { activo: false })
  assert.equal(apagado.activo, false)
})

// Un consultorio lo comparten dos doctores: uno de mañana y otro de tarde.
//
// La casilla libre del televisor rotulaba SIEMPRE al primero de la lista, asi
// que por la tarde seguia anunciando al doctor de la mañana y el paciente
// entraba preguntando por alguien que ya se habia ido.
test('la pantalla rotula al doctor de la jornada que corre, no al primero', async () => {
  const modulo = await repo.crearModulo({
    nombre: 'Consultorio compartido 77',
    servicioId: 'srv-consulta-externa',
    activo: true,
  })

  // El de la mañana se crea PRIMERO a proposito: es el que salia siempre.
  const manana = await repo.crearProfesional({
    nombre: 'Dra. Solo Manana',
    servicioId: 'srv-consulta-externa',
    jornada: 'MANANA',
    moduloId: modulo.id,
  })
  const tarde = await repo.crearProfesional({
    nombre: 'Dr. Solo Tarde',
    servicioId: 'srv-consulta-externa',
    jornada: 'TARDE',
    moduloId: modulo.id,
  })

  // Los dos con pacientes HOY: el televisor solo rotula a quien de verdad
  // atiende ese dia, asi que sin citas la casilla ni siquiera se pintaria.
  await pacienteEnEspera(manana.id, '08:00')
  await pacienteEnEspera(tarde.id, '14:00')

  // Se calcula aparte con la misma regla del dominio, para que la prueba valga
  // a cualquier hora a la que se ejecute.
  const configuracion = await repo.configuracion()
  const aMinutos = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
  const ahora = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
  const esManana = aMinutos(ahora) < aMinutos(configuracion.jornadaMananaFin)
  const esperado = esManana ? manana.nombre : tarde.nombre

  const { casillas } = await repo.estadoPantalla()
  const casilla = casillas.find((c) => c.moduloId === modulo.id)

  assert.equal(casilla.profesionalNombre, esperado)
})

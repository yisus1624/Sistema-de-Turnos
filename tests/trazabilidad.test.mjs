// Trazabilidad: de cada turno y de cada cita hay que poder reconstruir despues
// quien hizo que, cuando, y si de verdad paso.
//
// Estas pruebas cubren huecos que se encontraron revisando el sistema y que
// tenian todos la misma forma: no fallaba nada, simplemente el dato no quedaba
// en ninguna parte, o quedaba falseado.
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

const repo = new InMemoryTurnoRepository()

function diaColombia(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(fecha)
}

const HOY = diaColombia()
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/** Instante de una franja. El desfase de Colombia va a mano, como en el resto. */
function enFranja(hora, dia = HOY) {
  return new Date(`${dia}T${hora}:00-05:00`).toISOString()
}

/** Un doctor nuevo con su consultorio, para no heredar filas de otras pruebas. */
let creados = 0
async function doctorConConsultorio(jornada = 'COMPLETA') {
  creados += 1
  const modulo = await repo.crearModulo({
    nombre: `Consultorio traza ${creados}`,
    servicioId: 'srv-consulta-externa',
    activo: true,
  })
  const doctor = await repo.crearProfesional({
    nombre: `Dr. Traza ${creados}`,
    servicioId: 'srv-consulta-externa',
    jornada,
    moduloId: modulo.id,
  })
  return { doctor, modulo }
}

let documentos = 600000
async function citaDe(profesionalId, hora, dia = HOY) {
  documentos += 1
  return repo.crearCita({
    documentoPaciente: String(documentos),
    nombrePaciente: `Paciente ${documentos}`,
    profesionalId,
    horaCita: enFranja(hora, dia),
    usuarioId: 'usuario-mostrador',
  })
}

async function enEspera(profesionalId, hora) {
  const cita = await citaDe(profesionalId, hora)
  const turno = await repo.registrarLlegada(cita.id)
  return { cita, turno }
}

// --- El recorrido del turno ---

test('repetir el llamado NO reescribe la hora del primer llamado', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  const { turno } = await enEspera(doctor.id, '08:00')

  const llamado = await repo.llamarSiguiente({
    profesionalId: doctor.id,
    moduloId: modulo.id,
    funcionarioId: doctor.id,
  })
  const primerLlamado = llamado.horaPrimerLlamado
  assert.ok(primerLlamado, 'el primer llamado queda grabado')
  assert.equal(llamado.horaLlamado, primerLlamado)

  await dormir(30)
  const repetido = await repo.repetirLlamado(turno.id)

  assert.equal(repetido.horaPrimerLlamado, primerLlamado, 'el primero no se toca nunca')
  assert.notEqual(repetido.horaLlamado, primerLlamado, 'el ultimo si avanza: la pantalla ordena por el')
  assert.equal(repetido.vecesLlamado, 2)
})

test('la espera se mide contra el primer llamado, no contra el ultimo', async () => {
  // Antes, repetir el llamado alargaba en el informe la espera del paciente,
  // porque se medía contra la hora repetida, que es posterior.
  const { doctor, modulo } = await doctorConConsultorio()
  const { turno } = await enEspera(doctor.id, '08:15')

  const llamado = await repo.llamarSiguiente({
    profesionalId: doctor.id,
    moduloId: modulo.id,
    funcionarioId: doctor.id,
  })

  await dormir(60)
  await repo.repetirLlamado(turno.id)

  const historico = await repo.historico({ profesionalId: doctor.id, fecha: HOY })
  const guardado = historico.find((t) => t.id === turno.id)

  const esperaReal =
    new Date(llamado.horaPrimerLlamado).getTime() - new Date(guardado.fechaGeneracion).getTime()
  const esperaSiSeMidieraMal =
    new Date(guardado.horaLlamado).getTime() - new Date(guardado.fechaGeneracion).getTime()

  assert.ok(esperaSiSeMidieraMal > esperaReal, 'medir contra el ultimo llamado inflaria la espera')
})

test('cerrar un turno deja quien lo cerro y cuando', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  const { turno } = await enEspera(doctor.id, '08:30')

  await repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: 'quien-llamo' })
  const cerrado = await repo.marcarAtendido(turno.id, 'quien-cerro')

  assert.equal(cerrado.funcionarioId, 'quien-llamo')
  assert.equal(cerrado.cerradoPor, 'quien-cerro', 'quien llama y quien cierra pueden no ser el mismo')
  assert.ok(cerrado.cerradoEn)
  assert.equal(cerrado.cierreAutomatico, false)
})

test('marcar ausente deja hora de cierre y responsable, y NO hora de atencion', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  const { turno } = await enEspera(doctor.id, '08:45')

  await repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: doctor.id })
  const ausente = await repo.marcarAusente(turno.id, doctor.id)

  assert.equal(ausente.estado, 'AUSENTE')
  assert.ok(ausente.cerradoEn, 'antes no quedaba ninguna marca de tiempo')
  assert.equal(ausente.cerradoPor, doctor.id)
  assert.equal(ausente.horaAtencion ?? null, null, 'a este paciente no se le atendio')
})

test('un cierre automatico se distingue de uno que hizo el doctor', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  const { turno: primero } = await enEspera(doctor.id, '09:00')
  await enEspera(doctor.id, '09:15')

  await repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: doctor.id })
  // El doctor no cierra a nadie: solo pasa al siguiente.
  await repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: doctor.id })

  const historico = await repo.historico({ profesionalId: doctor.id, fecha: HOY })
  const cerradoSolo = historico.find((t) => t.id === primero.id)

  assert.equal(cerradoSolo.estado, 'ATENDIDO')
  assert.equal(cerradoSolo.cierreAutomatico, true, 'no lo cerro nadie')
  assert.equal(cerradoSolo.cerradoPor, null, 'y por tanto no hay responsable')
})

// --- La cita ---

test('cancelar una cita deja quien, cuando y por que', async () => {
  const { doctor } = await doctorConConsultorio()
  const cita = await citaDe(doctor.id, '09:30')

  const cancelada = await repo.cancelarCita(cita.id, {
    usuarioId: 'usuario-mostrador',
    motivo: 'El paciente aviso que no puede venir',
  })

  assert.equal(cancelada.estado, 'CANCELADA')
  assert.equal(cancelada.canceladaPor, 'usuario-mostrador')
  assert.equal(cancelada.motivoCancelacion, 'El paciente aviso que no puede venir')
  assert.ok(cancelada.canceladaEn)
})

test('una cita cancelada no se puede volver a cancelar', async () => {
  const { doctor } = await doctorConConsultorio()
  const cita = await citaDe(doctor.id, '09:45')
  await repo.cancelarCita(cita.id, { usuarioId: 'u1' })

  await assert.rejects(() => repo.cancelarCita(cita.id, { usuarioId: 'u1' }), /ya estaba cancelada/i)
})

// --- Reprogramar ---

test('reprogramar conserva la cita y guarda de donde venia', async () => {
  const { doctor } = await doctorConConsultorio()
  const cita = await citaDe(doctor.id, '10:00')
  const horaOriginal = cita.horaCita

  const movida = await repo.reprogramarCita(cita.id, {
    horaCita: enFranja('11:00'),
    motivo: 'El doctor entro tarde',
    usuarioId: 'usuario-mostrador',
  })

  assert.equal(movida.id, cita.id, 'es LA MISMA cita, no una nueva')
  assert.equal(movida.estado, 'PROGRAMADA')
  assert.equal(movida.horaCitaOriginal, horaOriginal)
  assert.equal(movida.vecesReprogramada, 1)
  assert.equal(movida.reprogramadaPor, 'usuario-mostrador')
  assert.equal(movida.motivoReprogramacion, 'El doctor entro tarde')
})

test('la hora original es la PRIMERA de todas, por muchas veces que se mueva', async () => {
  const { doctor } = await doctorConConsultorio()
  const cita = await citaDe(doctor.id, '10:15')
  const horaOriginal = cita.horaCita

  await repo.reprogramarCita(cita.id, { horaCita: enFranja('11:15') })
  const tercera = await repo.reprogramarCita(cita.id, { horaCita: enFranja('11:30') })

  assert.equal(tercera.horaCitaOriginal, horaOriginal, 'la primera, no la anterior')
  assert.equal(tercera.vecesReprogramada, 2)
})

test('reprogramar pasa por las mismas reglas de la parrilla que agendar', async () => {
  const { doctor } = await doctorConConsultorio()
  const cita = await citaDe(doctor.id, '10:30')
  await citaDe(doctor.id, '10:45')

  // Cupo ya ocupado por el otro paciente.
  await assert.rejects(
    () => repo.reprogramarCita(cita.id, { horaCita: enFranja('10:45') }),
    /ya tiene un paciente/i,
  )

  // Hora que no cae en ninguna franja de consulta.
  await assert.rejects(
    () => repo.reprogramarCita(cita.id, { horaCita: enFranja('10:37') }),
    /no son una hora de consulta/i,
  )

  // Dia que ya paso.
  const ayer = diaColombia(new Date(Date.now() - 24 * 60 * 60 * 1000))
  await assert.rejects(
    () => repo.reprogramarCita(cita.id, { horaCita: enFranja('10:30', ayer) }),
    /ya paso/i,
  )
})

test('dejarle la misma hora y cambiarle solo el doctor no choca consigo misma', async () => {
  const a = await doctorConConsultorio()
  const b = await doctorConConsultorio()
  const cita = await citaDe(a.doctor.id, '11:45')

  const movida = await repo.reprogramarCita(cita.id, {
    horaCita: cita.horaCita,
    profesionalId: b.doctor.id,
  })

  assert.equal(movida.profesionalId, b.doctor.id)
  assert.equal(movida.vecesReprogramada, 1)
})

test('un paciente que ya llego no se reprograma: primero hay que cerrar su turno', async () => {
  const { doctor } = await doctorConConsultorio()
  const { cita } = await enEspera(doctor.id, '11:45')

  await assert.rejects(
    () => repo.reprogramarCita(cita.id, { horaCita: enFranja('14:15') }),
    /ya registro su llegada/i,
  )
})

// --- Lo que se puede medir ---

test('el que nunca llego cuenta como inasistencia, no como ausente', async () => {
  const { doctor, modulo } = await doctorConConsultorio()

  // Uno que llego y no respondio al llamado: AUSENTE.
  const { turno } = await enEspera(doctor.id, '13:15')
  await repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: doctor.id })
  await repo.marcarAusente(turno.id, doctor.id)

  // Otro que ni aparecio, con la hora ya pasada: INASISTENCIA.
  await citaDe(doctor.id, '07:00')

  const estadisticas = await repo.estadisticas(HOY)
  const consultaExterna = estadisticas.porServicio.find((s) => s.servicioId === 'srv-consulta-externa')

  assert.ok(consultaExterna.ausentes >= 1, 'llego y no respondio')
  assert.ok(consultaExterna.inasistencias >= 1, 'ni siquiera llego')
  assert.ok(consultaExterna.citasAgendadas >= 2)
})

test('las citas cuya hora aun no llega no cuentan como inasistencia', async () => {
  const { doctor } = await doctorConConsultorio()

  const antes = (await repo.estadisticas(HOY)).total.inasistencias
  // Una cita de mañana no puede contar hoy como que el paciente no vino.
  const manana = diaColombia(new Date(Date.now() + 24 * 60 * 60 * 1000))
  await citaDe(doctor.id, '10:00', manana)

  assert.equal((await repo.estadisticas(HOY)).total.inasistencias, antes)
})

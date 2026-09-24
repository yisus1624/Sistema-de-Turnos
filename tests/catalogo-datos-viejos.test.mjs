// Datos viejos no bloquean para siempre las tareas del administrador.
//
// Las comprobaciones de baja, cambio de servicio, de jornada y de modo de fila
// contaban turnos y citas de CUALQUIER dia: un paciente que quedo LLAMADO ayer
// o una inasistencia de hace un mes (se quedan en PROGRAMADA para siempre)
// pedian "cierralos" o "cancelalas", algo que ya no se puede hacer. Solo cuenta
// lo vivo: lo de hoy (o de hoy en adelante, en las citas). Y desactivar el
// consultorio de un doctor con pacientes hoy le dejaba sin poder llamarlos.
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')
const repo = new InMemoryTurnoRepository()

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
const HACE_UN_MES = new Date(Date.now() - 30 * 86_400_000).toISOString()

let creados = 0
async function doctorConConsultorio(servicioId = 'srv-consulta-externa') {
  creados += 1
  const modulo = await repo.crearModulo({ nombre: `Consultorio viejo ${creados}`, servicioId, activo: true })
  const doctor = await repo.crearProfesional({ nombre: `Dr. Viejo ${creados}`, servicioId, jornada: 'COMPLETA', moduloId: modulo.id })
  return { doctor, modulo }
}

async function citaDeHoy(profesionalId, hora) {
  creados += 1
  return repo.crearCita({
    documentoPaciente: String(500000 + creados),
    nombrePaciente: `Paciente ${creados}`,
    profesionalId,
    horaCita: new Date(`${HOY}T${hora}:00-05:00`).toISOString(),
  })
}

/**
 * Lleva al pasado una cita (y su turno), como si fueran de hace un mes. Se
 * tocan los objetos del estado en memoria: `historico` devuelve copias.
 */
async function alPasado(cita, turno = null) {
  const [enMemoria] = (await repo.listarCitas({ profesionalId: cita.profesionalId })).filter((c) => c.id === cita.id)
  enMemoria.horaCita = HACE_UN_MES
  if (turno) Object.assign(turno, { fechaGeneracion: HACE_UN_MES, horaLlamado: HACE_UN_MES })
}

test('7a: un paciente que quedo LLAMADO otro dia no impide dar de baja al doctor', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  const cita = await citaDeHoy(doctor.id, '08:00')
  await repo.registrarLlegada(cita.id)
  const llamado = await repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: doctor.id })
  await alPasado(cita, llamado)

  const dado = await repo.actualizarProfesional(doctor.id, { activo: false })
  assert.equal(dado.activo, false)
})

test('7b: una inasistencia vieja no impide cambiarle al doctor el servicio ni la jornada', async () => {
  const { doctor } = await doctorConConsultorio()
  await alPasado(await citaDeHoy(doctor.id, '08:00'))

  const deTarde = await repo.actualizarProfesional(doctor.id, { jornada: 'TARDE' })
  assert.equal(deTarde.jornada, 'TARDE')

  const otro = await repo.crearServicio({ nombre: 'Servicio 7b', prefijo: 'QB', modoFila: 'POR_PROFESIONAL', activo: true })
  const movido = await repo.actualizarProfesional(doctor.id, { servicioId: otro.id })
  assert.equal(movido.servicioId, otro.id)
})

test('7c: un turno de ventanilla de otro dia no impide pasar el servicio a atencion por cita', async () => {
  const servicio = await repo.crearServicio({ nombre: 'Ventanilla 7c', prefijo: 'QC', modoFila: 'COMPARTIDA', activo: true })
  const turno = await repo.generarTurnoDeVentanilla(servicio.id)
  turno.fechaGeneracion = HACE_UN_MES

  const cambiado = await repo.actualizarServicio(servicio.id, { modoFila: 'POR_PROFESIONAL' })
  assert.equal(cambiado.modoFila, 'POR_PROFESIONAL')
})

test('7c: las citas ya atendidas del historico no impiden pasar el servicio a ventanilla', async () => {
  const servicio = await repo.crearServicio({ nombre: 'Especialidad 7c', prefijo: 'QD', modoFila: 'POR_PROFESIONAL', activo: true })
  const { doctor, modulo } = await doctorConConsultorio(servicio.id)
  await repo.registrarLlegada((await citaDeHoy(doctor.id, '09:00')).id)
  const llamado = await repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: doctor.id })
  await repo.marcarAtendido(llamado.id, doctor.id)
  await repo.actualizarProfesional(doctor.id, { servicioId: 'srv-consulta-externa' })

  const cambiado = await repo.actualizarServicio(servicio.id, { modoFila: 'COMPARTIDA' })
  assert.equal(cambiado.modoFila, 'COMPARTIDA')
})

test('7d: no se desactiva el consultorio de un doctor con pacientes hoy; se dice cuantos y que hacer', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  await repo.registrarLlegada((await citaDeHoy(doctor.id, '10:00')).id)
  await citaDeHoy(doctor.id, '10:15')

  await assert.rejects(
    () => repo.actualizarModulo(modulo.id, { activo: false }),
    (error) => {
      assert.match(error.message, /1 doctor\(es\).*2 paciente\(s\) hoy/)
      assert.match(error.message, /otro consultorio/)
      return true
    },
  )

  // Reasignado el doctor, el consultorio ya se puede apagar.
  const otro = await repo.crearModulo({ nombre: `Consultorio nuevo ${creados}`, servicioId: 'srv-consulta-externa', activo: true })
  await repo.actualizarProfesional(doctor.id, { moduloId: otro.id })
  assert.equal((await repo.actualizarModulo(modulo.id, { activo: false })).activo, false)
})

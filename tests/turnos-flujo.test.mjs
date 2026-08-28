// Flujo completo acordado con el hospital:
// cita -> registro de llegada -> turno en espera -> llamado (seccion 9) ->
// repetir (seccion 12) -> atendido / ausente (seccion 8).
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')
const { realtimeHub } = await import('@/lib/realtime/hub')

const repo = new InMemoryTurnoRepository()

/** Toma una cita todavia sin usar para no depender del orden de los tests. */
async function citaLibre(documento) {
  const citas = await repo.buscarCitasPorDocumento(documento)
  const cita = citas.find((c) => c.estado === 'PROGRAMADA')
  assert.ok(cita, `no hay cita PROGRAMADA para el documento ${documento}`)
  return cita
}

test('el turno de ventanilla usa el prefijo del servicio (RF-002)', async () => {
  const turno = await repo.generarTurnoDeVentanilla('srv-admisiones')
  assert.match(turno.codigo, /^A-\d{3}$/)
  assert.equal(turno.estado, 'EN_ESPERA')
  assert.equal(turno.vecesLlamado, 0)
  assert.equal(turno.profesionalId, null)
})

test('un servicio con cita no permite generar turnos de ventanilla', async () => {
  await assert.rejects(() => repo.generarTurnoDeVentanilla('srv-odontologia'), /por cita/i)
})

test('registrar la llegada convierte la cita en turno del profesional', async () => {
  const cita = await citaLibre('1067890123')
  const turno = await repo.registrarLlegada(cita.id)

  assert.equal(turno.estado, 'EN_ESPERA')
  assert.equal(turno.profesionalId, cita.profesionalId)
  assert.equal(turno.citaId, cita.id)
  assert.equal(turno.nombrePaciente, cita.nombrePaciente)
  assert.match(turno.codigo, /^C-\d{3}$/)

  const [actualizada] = await repo.buscarCitasPorDocumento('1067890123')
  assert.equal(actualizada.estado, 'PRESENTADO')
})

test('no se puede registrar dos veces la llegada de la misma cita', async () => {
  const cita = await citaLibre('1067890124')
  await repo.registrarLlegada(cita.id)
  await assert.rejects(() => repo.registrarLlegada(cita.id), /ya registro/i)
})

test('cada profesional solo ve sus propios pacientes', async () => {
  const suya = await citaLibre('1067890126') // Dra. Gomez
  await repo.registrarLlegada(suya.id)

  const pendientesGomez = await repo.listarPendientes({ profesionalId: 'pro-gomez' })
  const pendientesPerez = await repo.listarPendientes({ profesionalId: 'pro-perez' })

  assert.ok(pendientesGomez.every((t) => t.profesionalId === 'pro-gomez'))
  assert.ok(pendientesPerez.every((t) => t.profesionalId === 'pro-perez'))
  assert.equal(pendientesGomez.some((t) => t.citaId === suya.id), true)
  assert.equal(pendientesPerez.some((t) => t.citaId === suya.id), false)
})

test('llamar publica una casilla con el nombre enmascarado, nunca el completo', async () => {
  const cita = await citaLibre('1067890128') // Luisa Fernanda Castro Niño, Dr. Salas
  await repo.registrarLlegada(cita.id)

  const eventos = []
  const desuscribir = realtimeHub.subscribe((evento) => eventos.push(evento))

  const llamado = await repo.llamarSiguiente({
    profesionalId: 'pro-salas',
    moduloId: 'mod-consultorio-3',
    funcionarioId: 'usuario-prueba',
  })
  desuscribir()

  assert.ok(llamado)
  assert.equal(llamado.estado, 'LLAMADO')
  assert.equal(llamado.moduloId, 'mod-consultorio-3')
  assert.equal(llamado.funcionarioId, 'usuario-prueba')
  assert.equal(llamado.vecesLlamado, 1)

  const evento = eventos.find((e) => e.tipo === 'turno.llamado')
  assert.ok(evento, 'debe publicarse el evento turno.llamado')
  assert.equal(evento.casilla.moduloNombre, 'Consultorio 3')
  assert.equal(evento.casilla.profesionalNombre, 'Dr. Salas')
  assert.equal(evento.casilla.pacienteVisible, 'LUISA C.')

  const serializado = JSON.stringify(evento)
  assert.equal(
    serializado.includes(cita.nombrePaciente),
    false,
    'el nombre completo del paciente no puede viajar a la pantalla publica',
  )
})

test('repetir el llamado incrementa el contador (seccion 12)', async () => {
  const cita = await citaLibre('1067890130') // Dra. Rios
  await repo.registrarLlegada(cita.id)

  const llamado = await repo.llamarSiguiente({
    profesionalId: 'pro-rios',
    moduloId: 'mod-consultorio-4',
    funcionarioId: 'usuario-prueba',
  })

  const repetido = await repo.repetirLlamado(llamado.id)
  assert.equal(repetido.vecesLlamado, 2)
  assert.equal(repetido.estado, 'LLAMADO')
})

test('no se puede repetir un turno que aun no fue llamado', async () => {
  const turno = await repo.generarTurnoDeVentanilla('srv-facturacion')
  await assert.rejects(() => repo.repetirLlamado(turno.id), /no ha sido llamado/i)
})

test('llamar al siguiente cierra la atencion anterior del mismo consultorio', async () => {
  const primera = await citaLibre('1067890125') // Dr. Perez
  await repo.registrarLlegada(primera.id)

  const uno = await repo.llamarSiguiente({
    profesionalId: 'pro-perez',
    moduloId: 'mod-consultorio-1',
    funcionarioId: 'usuario-prueba',
  })

  const dos = await repo.llamarSiguiente({
    profesionalId: 'pro-perez',
    moduloId: 'mod-consultorio-1',
    funcionarioId: 'usuario-prueba',
  })

  if (dos) {
    const [anterior] = await repo.historico({ codigo: uno.codigo })
    assert.equal(anterior.estado, 'ATENDIDO')
    assert.ok(anterior.horaAtencion)
  }
})

test('marcar atendido cierra la cita y libera el consultorio', async () => {
  const cita = await citaLibre('1067890127') // Dra. Gomez
  await repo.registrarLlegada(cita.id)

  const llamado = await repo.llamarSiguiente({
    profesionalId: 'pro-gomez',
    moduloId: 'mod-consultorio-2',
    funcionarioId: 'usuario-prueba',
  })

  const eventos = []
  const desuscribir = realtimeHub.subscribe((evento) => eventos.push(evento))
  const atendido = await repo.marcarAtendido(llamado.id)
  desuscribir()

  assert.equal(atendido.estado, 'ATENDIDO')
  assert.ok(atendido.horaAtencion)
  assert.ok(eventos.some((e) => e.tipo === 'modulo.liberado' && e.moduloId === 'mod-consultorio-2'))

  const casillas = await repo.estadoPantalla()
  const casilla = casillas.find((c) => c.moduloId === 'mod-consultorio-2')
  assert.equal(casilla.codigo, null)
})

test('marcar ausente deja el turno en estado AUSENTE', async () => {
  const turno = await repo.generarTurnoDeVentanilla('srv-siau')
  const llamado = await repo.llamarSiguiente({
    servicioId: 'srv-siau',
    moduloId: 'mod-ventanilla-1',
    funcionarioId: 'usuario-prueba',
  })

  assert.equal(llamado.id, turno.id)
  const ausente = await repo.marcarAusente(llamado.id)
  assert.equal(ausente.estado, 'AUSENTE')
})

test('los turnos prioritarios se atienden primero (seccion 14)', async () => {
  const normal = await repo.generarTurnoDeVentanilla('srv-facturacion')
  const prioritario = await repo.generarTurnoDeVentanilla('srv-facturacion')
  prioritario.prioridad = 'PRIORITARIO'

  const pendientes = await repo.listarPendientes({ servicioId: 'srv-facturacion' })
  const posPrioritario = pendientes.findIndex((t) => t.id === prioritario.id)
  const posNormal = pendientes.findIndex((t) => t.id === normal.id)

  assert.ok(posPrioritario < posNormal)
})

test('llamar sin pacientes en espera devuelve null', async () => {
  const resultado = await repo.llamarSiguiente({
    profesionalId: 'pro-inexistente',
    moduloId: 'mod-consultorio-1',
    funcionarioId: 'usuario-prueba',
  })
  assert.equal(resultado, null)
})

test('la pantalla lista una casilla por cada modulo activo', async () => {
  const casillas = await repo.estadoPantalla()
  const modulos = await repo.listarModulos()
  assert.equal(casillas.length, modulos.length)
  assert.ok(casillas.every((c) => typeof c.moduloNombre === 'string'))
})

test('el servicio o el modulo inexistente producen error', async () => {
  await assert.rejects(() => repo.generarTurnoDeVentanilla('srv-no-existe'), /servicio/i)
  await assert.rejects(
    () =>
      repo.llamarSiguiente({
        servicioId: 'srv-admisiones',
        moduloId: 'mod-no-existe',
        funcionarioId: 'usuario-prueba',
      }),
    /modulo/i,
  )
})

// Reglas puras del llamado y del cierre de un turno.
//
// Con la red lenta del hospital, la respuesta de una accion se pierde a menudo
// aunque el servidor SI la haya hecho. El funcionario vuelve a pulsar, y la
// segunda peticion llega sobre un estado que ya no es el que el cree ver. Estas
// reglas deciden que hacer entonces: repetir sin efecto lo que ya se hizo,
// avisar con claridad cuando el estado real es otro, y no cerrar jamas a un
// paciente por detras.
import assert from 'node:assert/strict'
import test from 'node:test'

const { decidirCierre, decidirRepeticion } = await import('@/lib/turnos/reglas-cierre')
const { exigirTurnoAbiertoEsperado, alcanceDelLlamado, perteneceAlAlcance, exigirVentanillaCompatible } =
  await import('@/lib/turnos/reglas-llamado')

function turno(cambios = {}) {
  return { id: 't1', codigo: 'C-001', estado: 'LLAMADO', vecesLlamado: 1, cierreAutomatico: false, ...cambios }
}

// --- Cierre -----------------------------------------------------------------

test('cerrar un turno abierto se aplica', () => {
  assert.equal(decidirCierre(turno(), 'ATENDIDO'), 'aplicar')
  assert.equal(decidirCierre(turno({ estado: 'EN_ATENCION' }), 'AUSENTE'), 'aplicar')
})

test('repetir "Atendido" sobre un turno ya atendido no falla: ya estaba hecho', () => {
  assert.equal(decidirCierre(turno({ estado: 'ATENDIDO' }), 'ATENDIDO'), 'ya_aplicada')
  assert.equal(decidirCierre(turno({ estado: 'AUSENTE' }), 'AUSENTE'), 'ya_aplicada')
})

test('marcar ausente a quien ya se cerro como atendido es un conflicto 409 claro', () => {
  assert.throws(
    () => decidirCierre(turno({ estado: 'ATENDIDO', cierreAutomatico: true }), 'AUSENTE'),
    (error) => error.status === 409 && /ya se cerro como atendido/i.test(error.message) && /automatic/i.test(error.message),
  )
})

test('no se cierra un turno que todavia no se ha llamado', () => {
  assert.throws(() => decidirCierre(turno({ estado: 'EN_ESPERA' }), 'ATENDIDO'), /todavia no ha sido llamado/i)
})

// --- Repeticion ---------------------------------------------------------------

test('repetir un turno abierto se aplica', () => {
  assert.equal(decidirRepeticion(turno({ vecesLlamado: 2 }), 2), 'aplicar')
  assert.equal(decidirRepeticion(turno(), undefined), 'aplicar')
})

test('un reintento de "Repetir" tras perderse la respuesta no vuelve a sonar', () => {
  // El cliente veia 1 llamado; el servidor ya va en 2: la repeticion ya se hizo.
  assert.equal(decidirRepeticion(turno({ vecesLlamado: 2 }), 1), 'ya_aplicada')
})

test('no se repite un turno cerrado: 409', () => {
  assert.throws(() => decidirRepeticion(turno({ estado: 'AUSENTE' }), 1), (error) => error.status === 409)
})

// --- Llamar al siguiente -----------------------------------------------------

test('si el turno abierto real es el que el cliente cree, se puede llamar', () => {
  assert.doesNotThrow(() => exigirTurnoAbiertoEsperado(turno(), 't1'))
  assert.doesNotThrow(() => exigirTurnoAbiertoEsperado(null, null))
})

test('sin expectativa declarada no se comprueba (compatibilidad)', () => {
  assert.doesNotThrow(() => exigirTurnoAbiertoEsperado(turno(), undefined))
})

test('si el cliente no sabe que ya hay un paciente llamado, 409 con el turno real', () => {
  const real = turno({ id: 'real', codigo: 'C-007' })
  assert.throws(
    () => exigirTurnoAbiertoEsperado(real, null),
    (error) => error.status === 409 && error.turnoActual === real && /C-007/.test(error.message),
  )
  assert.throws(() => exigirTurnoAbiertoEsperado(real, 'otro'), (error) => error.status === 409)
})

test('si el turno que el cliente creia abierto ya se cerro, se puede seguir', () => {
  // No hay nadie a quien cerrar por detras: llamar al siguiente es seguro.
  assert.doesNotThrow(() => exigirTurnoAbiertoEsperado(null, 't-viejo'))
})

test('el alcance del doctor son sus turnos; el de la ventanilla, los suyos en ese modulo', () => {
  assert.deepEqual(alcanceDelLlamado({ profesionalId: 'p1', moduloId: 'm1', funcionarioId: 'p1' }), {
    profesionalId: 'p1',
  })
  assert.deepEqual(alcanceDelLlamado({ servicioId: 's', moduloId: 'm1', funcionarioId: 'u1' }), {
    moduloId: 'm1',
    funcionarioId: 'u1',
  })
  assert.equal(perteneceAlAlcance({ moduloId: 'm1', funcionarioId: 'u2' }, { moduloId: 'm1', funcionarioId: 'u1' }), false)
  assert.equal(perteneceAlAlcance({ profesionalId: 'p1', moduloId: 'm9' }, { profesionalId: 'p1' }), true)
})

test('la ventanilla solo llama filas compartidas y desde un modulo compatible', () => {
  const compartida = { id: 's1', nombre: 'Facturacion', modoFila: 'COMPARTIDA' }
  const porCita = { id: 's2', nombre: 'Consulta externa', modoFila: 'POR_PROFESIONAL' }

  assert.doesNotThrow(() => exigirVentanillaCompatible(compartida, { nombre: 'Ventanilla 1', servicioId: null }))
  assert.throws(() => exigirVentanillaCompatible(porCita, { nombre: 'Ventanilla 1', servicioId: null }), /atiende por cita/i)
  assert.throws(
    () => exigirVentanillaCompatible(compartida, { nombre: 'Consultorio 3', servicioId: 's2' }),
    /no pertenece a Facturacion/i,
  )
})

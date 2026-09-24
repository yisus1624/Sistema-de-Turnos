// Admisiones no puede decirle "no tiene cita" a un paciente que si la tiene.
//
// La importacion guardaba el documento solo con letras y digitos, la cita hecha
// a mano se guardaba tal cual se tecleo, y la busqueda comparaba el texto
// exacto: con "1.067.890.123" en el buscador salia "No tiene cita para hoy" y
// el paciente con cita valida se iba a la fila de ventanilla.
import assert from 'node:assert/strict'
import test from 'node:test'

const { normalizarDocumento } = await import('@/lib/turnos/documento')
const { claveDeCita } = await import('@/lib/citas/plan-de-carga')
const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

const repo = new InMemoryTurnoRepository()
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
const aLas = (hora) => new Date(`${HOY}T${hora}:00-05:00`).toISOString()

test('puntos, espacios, guiones y el tipo escrito delante no cuentan', () => {
  for (const escrito of ['1.067.890.123', '1 067 890 123', '1067890123-', ' 1067890123 ', 'CC 1067890123', 'C.C. 1.067.890.123', 'cc-1067890123']) {
    assert.equal(normalizarDocumento(escrito), '1067890123', escrito)
  }
})

test('las letras del numero se conservan: un pasaporte no pierde las suyas', () => {
  assert.equal(normalizarDocumento('ab-123456'), 'AB123456')
  assert.equal(normalizarDocumento('PA AB123456'), 'AB123456', 'el tipo aparte si se quita')
  // Pegado al numero no se distingue de un pasaporte: se deja.
  assert.equal(normalizarDocumento('CC1067890123'), 'CC1067890123')
})

test('la cita hecha a mano con puntos aparece al buscar solo los digitos, y al reves', async () => {
  const cita = await repo.crearCita({
    documentoPaciente: '1.067.890.123',
    nombrePaciente: 'Paciente Con Puntos',
    profesionalId: 'pro-perez',
    horaCita: aLas('11:45'),
  })

  assert.equal(cita.documentoPaciente, '1067890123', 'se guarda normalizado')
  for (const buscado of ['1067890123', '1.067.890.123', 'CC 1067890123']) {
    const citas = await repo.buscarCitasPorDocumento(buscado)
    assert.ok(citas.some((c) => c.id === cita.id), buscado)
  }
})

test('una cita guardada antes con puntos tambien se encuentra, sin reescribirla', async () => {
  // Asi quedaron las citas hechas a mano antes de normalizar.
  const antigua = { ...(await repo.crearCita({
    documentoPaciente: '99887766',
    nombrePaciente: 'Paciente Antiguo',
    profesionalId: 'pro-gomez',
    horaCita: aLas('11:30'),
  })) }
  const guardada = globalThis.__turnosMemoria.citas.find((c) => c.id === antigua.id)
  guardada.documentoPaciente = '99.887.766'

  const citas = await repo.buscarCitasPorDocumento('99887766')

  assert.ok(citas.some((c) => c.id === antigua.id))
  assert.equal(guardada.documentoPaciente, '99.887.766', 'la fila antigua no se toca')
})

test('la carga del reporte reconoce la cita guardada con otro formato del mismo documento', () => {
  const hora = '2026-09-17T13:00:00.000Z'
  assert.equal(
    claveDeCita('2026-09-17', '1.067.890.123', 'pro-perez', hora),
    claveDeCita('2026-09-17', '1067890123', 'pro-perez', hora),
  )
})

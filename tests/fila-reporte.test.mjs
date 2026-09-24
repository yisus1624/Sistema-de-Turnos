// El reporte es sobre PACIENTES: nombre, documento, medico y consultorio.
// Antes solo decia el codigo del turno, que por si solo no le sirve a nadie.
import assert from 'node:assert/strict'
import test from 'node:test'

const { filaDeReporte } = await import('@/lib/reportes/filas')

const catalogos = {
  servicios: [{ id: 's1', nombre: 'Consulta externa' }],
  modulos: [{ id: 'm1', nombre: 'CONS 01- CONSULTA EXTERNA' }],
  profesionales: [{ id: 'p1', nombre: 'DRA. ANA RUIZ' }],
}

test('la fila trae paciente, documento con su tipo, medico, servicio y consultorio', () => {
  const fila = filaDeReporte(
    {
      id: 't1', codigo: 'C-001', servicioId: 's1', estado: 'ATENDIDO', prioridad: 'NORMAL', vecesLlamado: 1,
      fechaGeneracion: '2026-09-22T14:00:00.000Z', moduloId: 'm1', profesionalId: 'p1',
      nombrePaciente: 'MARIA PEREZ', documentoPaciente: '1234567', tipoDocumento: 'CC', procedimiento: 'CONSULTA GENERAL',
    },
    catalogos,
  )
  assert.equal(fila.paciente, 'MARIA PEREZ')
  assert.equal(fila.documento, 'CC 1234567')
  assert.equal(fila.medico, 'DRA. ANA RUIZ')
  assert.equal(fila.servicio, 'Consulta externa')
  assert.equal(fila.consultorio, 'CONS 01- CONSULTA EXTERNA')
  assert.equal(fila.procedimiento, 'CONSULTA GENERAL')
  assert.equal(fila.fecha, '2026-09-22')
})

test('un turno sin cita ni llamado lo dice en vez de dejar huecos raros', () => {
  const fila = filaDeReporte(
    { id: 't2', codigo: 'F-001', servicioId: 's1', estado: 'EN_ESPERA', prioridad: 'NORMAL', vecesLlamado: 0, fechaGeneracion: '2026-09-22T14:00:00.000Z' },
    catalogos,
  )
  assert.equal(fila.documento, '—')
  assert.equal(fila.consultorio, 'Sin llamar')
  assert.equal(fila.medico, '—')
})

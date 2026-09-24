// Un turno viejo de un servicio, consultorio o medico ya desactivado salia con
// "—" en Reportes, Historico y Turnos en curso: los catalogos que piden esas
// pantallas solo traen los activos. Ahora se completan con los nombres de los
// inactivos (solo lectura), sin tocar los selectores de filtro.
import assert from 'node:assert/strict'
import test from 'node:test'

const { conRespaldo, soloNombres } = await import('@/lib/turnos/nombres-de-respaldo')
const { filaDeReporte } = await import('@/lib/reportes/filas')

test('los nombres de respaldo completan los que faltan sin pisar los activos', () => {
  const activos = [{ id: 'a', nombre: 'Activo' }]
  const respaldo = [{ id: 'a', nombre: 'Viejo' }, { id: 'b', nombre: 'Desactivado' }]
  assert.deepEqual(conRespaldo(activos, respaldo), [
    { id: 'a', nombre: 'Activo' },
    { id: 'b', nombre: 'Desactivado' },
  ])
})

test('solo se exponen id y nombre', () => {
  assert.deepEqual(soloNombres([{ id: 'x', nombre: 'X', activo: false, prefijo: 'Q' }]), [{ id: 'x', nombre: 'X' }])
})

test('la fila del reporte resuelve el nombre de un servicio desactivado', () => {
  const servicios = conRespaldo([], [{ id: 's1', nombre: 'Odontologia' }])
  const fila = filaDeReporte(
    { id: 't', codigo: 'O-1', servicioId: 's1', estado: 'ATENDIDO', prioridad: 'NORMAL', vecesLlamado: 1, fechaGeneracion: '2026-09-22T14:00:00.000Z' },
    { servicios, modulos: [], profesionales: [] },
  )
  assert.equal(fila.servicio, 'Odontologia')
})

// Un turno en curso de un servicio desactivado no puede desaparecer del tablero.
import assert from 'node:assert/strict'
import test from 'node:test'

const { conInactivosMarcados } = await import('@/lib/turnos/nombres-de-respaldo')

test('los servicios desactivados se muestran con la marca (inactivo), sin pisar los activos', () => {
  const activos = [{ id: 's1', nombre: 'Odontologia' }]
  const respaldo = [
    { id: 's1', nombre: 'Odontologia vieja' },
    { id: 's2', nombre: 'Pediatria' },
  ]
  assert.deepEqual(conInactivosMarcados(activos, respaldo), [
    { id: 's1', nombre: 'Odontologia' },
    { id: 's2', nombre: 'Pediatria (inactivo)' },
  ])
})

// El nombre que llega a la pantalla de la sala de espera va enmascarado:
// mostrar el nombre completo junto al servicio revelaria un dato de salud.
import assert from 'node:assert/strict'
import test from 'node:test'

const { enmascararNombre } = await import('@/lib/turnos/privacidad')

test('deja el primer nombre y la inicial del primer apellido', () => {
  assert.equal(enmascararNombre('Juan Carlos Perez Gomez'), 'JUAN P.')
  assert.equal(enmascararNombre('Ana Lucia Martinez Vega'), 'ANA M.')
})

test('funciona con dos palabras', () => {
  assert.equal(enmascararNombre('Pedro Ruiz'), 'PEDRO R.')
})

test('ignora particulas de los apellidos compuestos', () => {
  assert.equal(enmascararNombre('Maria de los Angeles del Rio Santos'), 'MARIA R.')
})

test('una sola palabra se devuelve completa', () => {
  assert.equal(enmascararNombre('Madonna'), 'MADONNA')
})

test('vacio o nulo no producen texto', () => {
  assert.equal(enmascararNombre(''), null)
  assert.equal(enmascararNombre(null), null)
  assert.equal(enmascararNombre(undefined), null)
  assert.equal(enmascararNombre('   '), null)
})

test('nunca devuelve el apellido completo', () => {
  const resultado = enmascararNombre('Luisa Fernanda Castro Niño')
  assert.equal(resultado, 'LUISA C.')
  assert.equal(resultado.includes('CASTRO'), false)
  assert.equal(resultado.includes('NIÑO'), false)
})

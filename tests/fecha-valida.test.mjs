// Una fecha con el formato bien pero imposible (30 de febrero) llegaba a las
// consultas como valida: el historico y las estadisticas preguntaban por un
// dia que no existe y respondian vacio, como si ese dia no hubiera pasado nada.
import assert from 'node:assert/strict'
import test from 'node:test'

const { esFechaValida } = await import('@/lib/turnos/tiempo')

test('una fecha real con formato AAAA-MM-DD es valida', () => {
  assert.equal(esFechaValida('2026-09-22'), true)
  assert.equal(esFechaValida('2028-02-29'), true, 'año bisiesto')
})

test('una fecha imposible no es valida aunque tenga el formato', () => {
  for (const fecha of ['2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31']) {
    assert.equal(esFechaValida(fecha), false, fecha)
  }
})

test('otro formato no es valido', () => {
  assert.equal(esFechaValida('22/09/2026'), false)
  assert.equal(esFechaValida('2026-9-22'), false)
})

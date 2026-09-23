// Las pantallas que arrancan en "hoy" (agenda del doctor, estadisticas, agenda
// de citas) fijaban la fecha al abrirse. Una pantalla abierta de un dia para
// otro seguia mostrando el dia anterior pasada la medianoche de Colombia, sin
// que nadie hubiera elegido esa fecha.
import assert from 'node:assert/strict'
import test from 'node:test'

const { fechaTrasCambioDeDia } = await import('@/lib/api/cambio-de-dia')

test('quien estaba mirando hoy pasa al nuevo hoy a medianoche', () => {
  assert.equal(fechaTrasCambioDeDia('2026-09-22', '2026-09-22', '2026-09-23'), '2026-09-23')
})

test('quien eligio otro dia a proposito se queda en ese dia', () => {
  assert.equal(fechaTrasCambioDeDia('2026-09-15', '2026-09-22', '2026-09-23'), '2026-09-15')
})

test('sin cambio de dia no pasa nada', () => {
  assert.equal(fechaTrasCambioDeDia('2026-09-22', '2026-09-22', '2026-09-22'), '2026-09-22')
})

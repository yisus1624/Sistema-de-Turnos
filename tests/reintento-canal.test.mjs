// Cuanto espera el canal en vivo antes de reabrirse cuando el servidor lo
// rechazo (502/503 al reiniciar o desplegar). `EventSource` no reintenta solo
// en ese caso: sin esta espera la pantalla quedaba muda mas de un minuto.
import assert from 'node:assert/strict'
import test from 'node:test'

const { esperaDeReintento } = await import('@/lib/hooks')

test('el primer reintento es rapido, de un par de segundos', () => {
  assert.equal(esperaDeReintento(0, 0.5), 2000)
})

test('la espera se duplica en cada fallo hasta un tope de 30 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 10].map((i) => esperaDeReintento(i, 0.5)), [2000, 4000, 8000, 16000, 30000, 30000, 30000])
})

test('el azar reparte las reconexiones sin salirse de +-25 %', () => {
  assert.equal(esperaDeReintento(2, 0), 6000)
  assert.equal(esperaDeReintento(2, 1), 10000)
})

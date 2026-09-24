// Borrar la fecha ya no tumba Reportes ni la Agenda.
//
// El fallo real: en "Personalizado" el usuario corrige el dia con Retroceso,
// el selector queda vacio (''), y al pintar el titulo `Intl.DateTimeFormat`
// lanzaba "RangeError: Invalid time value": la pantalla entera moria. Igual en
// la Agenda con la fecha larga del dia y con las flechas de dia anterior o
// siguiente. Un año de cinco cifras ("20266") hacia lo mismo.
//
// Las pantallas ya no guardan una fecha invalida en su estado; ademas, lo que
// escribe la fecha no lanza nunca: devuelve '' y deja la fecha como estaba.
import assert from 'node:assert/strict'
import test from 'node:test'

const { periodoEnPalabras } = await import('@/lib/reportes/resumen')
const { fechaLarga, diaVecino } = await import('@/lib/api/dia-elegido')

const INVALIDAS = ['', '20266-09-22', '2026-02-30', '2026-9-22', 'no-es-fecha']

test('el periodo del reporte con una fecha borrada o imposible no lanza: sale vacio', () => {
  for (const mala of INVALIDAS) {
    assert.equal(periodoEnPalabras(mala, '2026-09-22'), '', `desde ${JSON.stringify(mala)}`)
    assert.equal(periodoEnPalabras('2026-09-01', mala), '', `hasta ${JSON.stringify(mala)}`)
  }
})

test('con fechas buenas el periodo se sigue escribiendo igual', () => {
  assert.match(periodoEnPalabras('2026-09-22', '2026-09-22'), /22 .*sept?.* 2026/)
  assert.match(periodoEnPalabras('2026-09-01', '2026-09-22'), /^1 – 22 .*2026$/)
})

test('la fecha larga de la agenda con una fecha borrada o imposible no lanza: sale vacia', () => {
  for (const mala of INVALIDAS) assert.equal(fechaLarga(mala), '', JSON.stringify(mala))
})

test('la fecha larga de un dia bueno se escribe como se dice en voz alta', () => {
  assert.equal(fechaLarga('2026-04-14'), 'martes, 14 de abril de 2026')
})

test('las flechas con una fecha borrada no lanzan: la fecha se queda como estaba', () => {
  for (const mala of INVALIDAS) {
    assert.equal(diaVecino(mala, 1), mala, JSON.stringify(mala))
    assert.equal(diaVecino(mala, -1), mala, JSON.stringify(mala))
  }
})

test('las flechas mueven un dia, tambien al cambiar de mes y de año', () => {
  assert.equal(diaVecino('2026-09-22', 1), '2026-09-23')
  assert.equal(diaVecino('2026-12-31', 1), '2027-01-01')
  assert.equal(diaVecino('2026-03-01', -1), '2026-02-28')
})

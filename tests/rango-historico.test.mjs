// El historico podia traerse la tabla entera de turnos en una sola consulta:
// meses de datos, en memoria del servidor y ocupando el pool de la base, por
// una pantalla abierta sin filtro de fechas.
import assert from 'node:assert/strict'
import test from 'node:test'

const { acotarRangoDelHistorico, abarcaMasDeUnDia, DIAS_MAXIMOS_HISTORICO } = await import('@/lib/turnos/rango-historico')

const HOY = '2026-09-22'

test('sin fechas se consulta solo el dia de hoy', () => {
  assert.deepEqual(acotarRangoDelHistorico({}, HOY), { fecha: HOY })
})

test('un dia concreto se respeta', () => {
  assert.deepEqual(acotarRangoDelHistorico({ fecha: '2026-09-01' }, HOY), { fecha: '2026-09-01' })
})

test('un rango dentro del maximo se respeta', () => {
  const rango = { fechaDesde: '2026-07-01', fechaHasta: '2026-09-22' }
  assert.deepEqual(acotarRangoDelHistorico(rango, HOY), rango)
})

test('un rango demasiado largo se rechaza con un aviso claro', () => {
  assert.throws(
    () => acotarRangoDelHistorico({ fechaDesde: '2025-01-01', fechaHasta: '2026-09-22' }, HOY),
    (error) => error.status === 400 && error.message.includes(String(DIAS_MAXIMOS_HISTORICO)),
  )
})

test('un rango con una sola punta se completa hasta el maximo, no hasta el infinito', () => {
  const { fechaDesde, fechaHasta } = acotarRangoDelHistorico({ fechaHasta: '2026-09-22' }, HOY)
  assert.equal(fechaHasta, '2026-09-22')
  assert.ok(fechaDesde && fechaDesde >= '2026-06-01')
})

test('una fecha mal escrita se rechaza', () => {
  assert.throws(() => acotarRangoDelHistorico({ fecha: '22/09/2026' }, HOY), (error) => error.status === 400)
})

test('una fecha y un rango a la vez se rechazan: no se elige uno en silencio', () => {
  assert.throws(
    () => acotarRangoDelHistorico({ fecha: '2026-09-01', fechaDesde: '2026-08-01', fechaHasta: '2026-09-22' }, HOY),
    (error) => error.status === 400 && /una fecha o un rango/i.test(error.message),
  )
})

test('un dia suelto no cuenta como consulta de varios dias; un rango de dos o mas si', () => {
  assert.equal(abarcaMasDeUnDia({ fecha: HOY }), false)
  assert.equal(abarcaMasDeUnDia({ fechaDesde: HOY, fechaHasta: HOY }), false)
  assert.equal(abarcaMasDeUnDia({ fechaDesde: '2026-09-21', fechaHasta: HOY }), true)
})

// Lo que resume la pantalla de Reportes y sus periodos rapidos.
import assert from 'node:assert/strict'
import test from 'node:test'

const { resumirTurnos, rangoDePeriodo, periodoEnPalabras } = await import('@/lib/reportes/resumen')

const turno = (estado, llegada, llamado = null, primer = null) => ({
  id: Math.random().toString(36),
  codigo: 'C-001',
  estado,
  fechaGeneracion: llegada,
  horaLlamado: llamado,
  horaPrimerLlamado: primer,
})

test('cuenta por estado y promedia la espera contra el primer llamado', () => {
  const resumen = resumirTurnos([
    turno('ATENDIDO', '2026-09-22T13:00:00Z', '2026-09-22T13:30:00Z', '2026-09-22T13:10:00Z'),
    turno('AUSENTE', '2026-09-22T13:00:00Z', '2026-09-22T13:20:00Z'),
    turno('EN_ESPERA', '2026-09-22T13:00:00Z'),
  ])
  assert.equal(resumen.total, 3)
  assert.equal(resumen.atendidos, 1)
  assert.equal(resumen.ausentes, 1)
  assert.equal(resumen.porEstado.EN_ESPERA, 1)
  assert.equal(resumen.esperaPromedioMin, 15, '(10 + 20) / 2: el repetido no alarga la espera')
})

test('sin llamados no hay espera promedio', () => {
  assert.equal(resumirTurnos([turno('EN_ESPERA', '2026-09-22T13:00:00Z')]).esperaPromedioMin, null)
  assert.equal(resumirTurnos([]).total, 0)
})

test('los periodos rapidos cuentan desde el dia de Colombia', () => {
  assert.deepEqual(rangoDePeriodo('hoy', '2026-09-22'), { desde: '2026-09-22', hasta: '2026-09-22' })
  assert.deepEqual(rangoDePeriodo('ayer', '2026-03-01'), { desde: '2026-02-28', hasta: '2026-02-28' })
  assert.deepEqual(rangoDePeriodo('semana', '2026-09-03'), { desde: '2026-08-28', hasta: '2026-09-03' })
  assert.deepEqual(rangoDePeriodo('mes', '2026-09-22'), { desde: '2026-09-01', hasta: '2026-09-22' })
})

test('el periodo se dice en palabras', () => {
  assert.match(periodoEnPalabras('2026-09-22', '2026-09-22'), /^22 de sept?\.? de 2026$/)
  assert.match(periodoEnPalabras('2026-09-01', '2026-09-22'), /^1 – 22 de sept?\.? de 2026$/)
})

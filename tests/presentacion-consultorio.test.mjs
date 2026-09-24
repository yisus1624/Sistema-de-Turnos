// Lo que calcula la pantalla del doctor para mostrarse.
import assert from 'node:assert/strict'
import test from 'node:test'

const { iniciales, documentoLegible, resumenDelDia, etiquetaDeRetroceso, queSeDeshace } = await import(
  '@/lib/consultorio/presentacion'
)

test('iniciales: nombre y primer apellido', () => {
  assert.equal(iniciales('Ana Maria Ortega Ruiz'), 'AO')
  assert.equal(iniciales('Luis Pardo'), 'LP')
  assert.equal(iniciales('carlos ramirez castillo'), 'CR')
  assert.equal(iniciales('Cher'), 'C')
  assert.equal(iniciales(''), '—')
})

test('el documento se lee con puntos, y lo que no es numero queda igual', () => {
  assert.equal(documentoLegible('1102834567'), '1.102.834.567')
  assert.equal(documentoLegible('AB-123'), 'AB-123')
  assert.equal(documentoLegible('  '), null)
})

test('el resumen del dia cuenta cada estado', () => {
  const agenda = ['EN_ESPERA', 'EN_ESPERA', 'ATENDIDA', 'AUSENTE', 'PROGRAMADA', 'LLAMADO'].map((estado) => ({ estado }))
  assert.deepEqual(resumenDelDia(agenda), { enEspera: 2, atendidos: 1, ausentes: 1, sinLlegar: 1, total: 6 })
})

test('el boton de retroceso dice a quien recupera', () => {
  assert.equal(etiquetaDeRetroceso(null), null)
  assert.equal(etiquetaDeRetroceso({ devolver: { codigo: 'C-011' }, restaurar: { codigo: 'C-010' } }), 'Volver a C-010')
  assert.equal(etiquetaDeRetroceso({ devolver: { codigo: 'C-011' }, restaurar: null }), 'Devolver C-011 a la fila')
  assert.match(queSeDeshace({ estado: 'AUSENTE' }, false), /No se presento/)
  assert.match(queSeDeshace({ estado: 'ATENDIDO' }, true), /al llamar al siguiente/)
})

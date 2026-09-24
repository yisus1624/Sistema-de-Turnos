// La pantalla del doctor no puede soltar "Llamar siguiente" mientras el
// llamado todavia puede estar reintentando: el doctor pulsaria de nuevo.
import assert from 'node:assert/strict'
import test from 'node:test'

const { msPeorCasoDelLlamado, ESPERAS_SI_OCUPADO_MS } = await import('@/lib/api/llamado-cliente')
const { MS_LIMITE_PETICION } = await import('@/lib/api/cliente')
const { MS_MAXIMO_POR_ACCION } = await import('@/lib/consultorio/tiempos')

test('el peor caso cuenta cada intento, cada espera y su variacion', () => {
  const intentos = ESPERAS_SI_OCUPADO_MS.length + 1
  const esperas = ESPERAS_SI_OCUPADO_MS.reduce((total, ms) => total + ms + 300, 0)
  assert.equal(msPeorCasoDelLlamado(), intentos * MS_LIMITE_PETICION + esperas)
})

test('la pantalla del doctor no suelta la accion antes del peor caso del llamado', () => {
  assert.ok(MS_MAXIMO_POR_ACCION > msPeorCasoDelLlamado())
})

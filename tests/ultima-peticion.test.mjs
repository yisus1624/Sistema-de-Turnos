// Tres cosas recargan la pantalla del doctor y la del operador a la vez: el
// canal en vivo, el final de cada accion y el cambio de servicio, ventanilla o
// fecha. Con la red lenta, sus respuestas llegan desordenadas, y una vieja que
// llega tarde pintaba "sin paciente" o el turno de otra ventanilla: el
// siguiente clic cerraba mal. Regla: solo cuenta la ultima peticion.
import assert from 'node:assert/strict'
import test from 'node:test'

const { crearUltimaPeticion } = await import('@/lib/api/ultima-peticion')

test('una peticion nueva deja sin efecto a la anterior y la cancela', () => {
  const peticiones = crearUltimaPeticion()
  const vieja = peticiones.iniciar()
  const nueva = peticiones.iniciar()

  assert.equal(vieja.esVigente(), false)
  assert.equal(vieja.signal.aborted, true)
  assert.equal(nueva.esVigente(), true)
  assert.equal(nueva.signal.aborted, false)
})

test('la respuesta vieja que llega despues de la nueva no se aplica', async () => {
  const peticiones = crearUltimaPeticion()
  const pintado = []

  async function cargar(valor, demora) {
    const peticion = peticiones.iniciar()
    await new Promise((resolver) => setTimeout(resolver, demora))
    if (peticion.esVigente()) pintado.push(valor)
  }

  await Promise.all([cargar('vieja', 30), cargar('nueva', 5)])

  assert.deepEqual(pintado, ['nueva'])
})

test('cancelar (al desmontar) invalida la peticion en curso', () => {
  const peticiones = crearUltimaPeticion()
  const enCurso = peticiones.iniciar()
  peticiones.cancelar()

  assert.equal(enCurso.esVigente(), false)
  assert.equal(enCurso.signal.aborted, true)
})

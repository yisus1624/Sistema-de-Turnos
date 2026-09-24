// Sin cuenta (o con la cuenta inactiva) tambien se paga el bcrypt: si no, la
// diferencia de ~250 ms delataba que usuarios existen.
import assert from 'node:assert/strict'
import test from 'node:test'

const { contrasenaCoincideSinDelatar, cifrarContrasena } = await import('@/lib/usuarios/contrasenas')

test('sin hash de cuenta nunca coincide, aunque se compare igual', async () => {
  assert.equal(await contrasenaCoincideSinDelatar('lo-que-sea', null), false)
})

test('con el hash de la cuenta coincide la contrasena correcta y no otra', async () => {
  const hash = await cifrarContrasena('correcta')
  assert.equal(await contrasenaCoincideSinDelatar('correcta', hash), true)
  assert.equal(await contrasenaCoincideSinDelatar('otra', hash), false)
})

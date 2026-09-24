// Una cookie de consultorio con un `%` roto es un token invalido, no un 500:
// con el 500 la pantalla del doctor reintentaba para siempre.
import assert from 'node:assert/strict'
import test from 'node:test'

const { tokenDeLaPeticion, COOKIE_CONSULTORIO } = await import('@/lib/turnos/acceso-consultorio')

function peticionConCookie(valor) {
  return new Request('http://localhost/api/consultorio', { headers: { cookie: `${COOKIE_CONSULTORIO}=${valor}` } })
}

test('una cookie con codificacion rota no lanza: no hay token', () => {
  assert.equal(tokenDeLaPeticion(peticionConCookie('abc%E0%A4%A')), '')
})

test('una cookie bien codificada se sigue leyendo', () => {
  assert.equal(tokenDeLaPeticion(peticionConCookie('abc%2Ddef')), 'abc-def')
})

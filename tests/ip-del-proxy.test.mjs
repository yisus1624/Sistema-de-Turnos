// De que cabecera sale la IP del cliente detras de nginx.
//
// La IP solo sirve si no la puede falsificar el cliente: con ella se frenan
// avalanchas por origen y se anota el registro de actividad.
import assert from 'node:assert/strict'
import test from 'node:test'

const { ipReenviadaPorElProxy } = await import('@/lib/seguridad/origen')

test('la IP que vale es la que escribio el proxy, no la que invento el cliente', () => {
  // Con un nginx que ANADE en vez de sobrescribir, el cliente puede meter lo
  // que quiera delante; lo ultimo de la lista lo puso siempre nuestro proxy.
  assert.equal(ipReenviadaPorElProxy('1.2.3.4, 198.51.100.9', null), '198.51.100.9')
  assert.equal(ipReenviadaPorElProxy('198.51.100.9', '10.0.0.1'), '198.51.100.9')
})

test('sin X-Forwarded-For se usa X-Real-IP, y sin ninguna no hay IP', () => {
  assert.equal(ipReenviadaPorElProxy(null, '198.51.100.9'), '198.51.100.9')
  assert.equal(ipReenviadaPorElProxy('  ', null), null)
  assert.equal(ipReenviadaPorElProxy(null, null), null)
})

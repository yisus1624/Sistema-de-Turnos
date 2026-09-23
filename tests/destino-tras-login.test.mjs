// A donde se vuelve despues de entrar.
//
// `volverA` llega en la URL del login y lo puede escribir cualquiera en un
// enlace. Comprobar "empieza por / y no por //" no bastaba: el navegador
// normaliza la barra invertida y el tabulador, y `/<barra invertida>evil.com`
// o `/<TAB>/evil.com` terminaban en `https://evil.com/` con la sesion recien
// abierta.
import assert from 'node:assert/strict'
import test from 'node:test'

const { destinoTrasEntrar } = await import('@/lib/auth-routing')

const ORIGEN = 'https://turnos.ejemplo.test'
const BARRA_INVERTIDA = String.fromCharCode(92)
const TABULADOR = String.fromCharCode(9)

test('una ruta interna se respeta, con su consulta', () => {
  assert.equal(destinoTrasEntrar('/operador/admisiones?x=1', ORIGEN), '/operador/admisiones?x=1')
})

test('los trucos de barra invertida y tabulador no sacan del sitio', () => {
  const intentos = [
    `/${BARRA_INVERTIDA}evil.com`,
    `/${TABULADOR}/evil.com`,
    '//evil.com',
    `${BARRA_INVERTIDA}${BARRA_INVERTIDA}evil.com`,
    'https://evil.com',
    'javascript:alert(1)',
  ]
  for (const intento of intentos) {
    const destino = destinoTrasEntrar(intento, ORIGEN)
    assert.equal(destino.startsWith('/') && !destino.startsWith('//'), true, JSON.stringify(intento))
    assert.equal(new URL(destino, ORIGEN).origin, ORIGEN, JSON.stringify(intento))
  }
})

test('la forma codificada (%5C) tampoco saca del sitio', () => {
  const destino = destinoTrasEntrar(decodeURIComponent('/%5Cevil.com'), ORIGEN)
  assert.equal(new URL(destino, ORIGEN).origin, ORIGEN)
})

test('sin volverA, o con uno de otro sitio, se va a la entrada del rol', () => {
  assert.equal(destinoTrasEntrar(null, ORIGEN), '/auth/redirect')
  assert.equal(destinoTrasEntrar('https://evil.com/x', ORIGEN), '/auth/redirect')
})

test('los segmentos con punto que el navegador colapsa a //otro-sitio tampoco sacan del sitio', () => {
  // Vectores comprobados por QA: resuelven al mismo origen, pero la ruta
  // queda en "//evil.com" y el router de Next la trata como externa.
  const intentos = [
    '/.//evil.com',
    '/..//evil.com',
    '/a/..//evil.com',
    '/%2e//evil.com',
    `${ORIGEN}//evil.com`,
    '/././/evil.com',
    '/a/b/../..//evil.com',
    `/.${BARRA_INVERTIDA}${BARRA_INVERTIDA}evil.com`,
    '/%2E%2E//evil.com',
  ]
  for (const intento of intentos) {
    const destino = destinoTrasEntrar(intento, ORIGEN)
    assert.equal(destino.startsWith('//') || destino.startsWith(`/${BARRA_INVERTIDA}`), false, JSON.stringify(intento))
    assert.equal(new URL(destino, `${ORIGEN}/auth/login`).origin, ORIGEN, JSON.stringify(intento))
  }
})

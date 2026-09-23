// Un enlace de consultorio con un "%" mal escrito (copiado a medias de un
// chat, por ejemplo) hacia fallar `decodeURIComponent` dentro de `proxy.ts`
// con un 500: el doctor veia una pagina de error del servidor en vez del aviso
// de "enlace no valido". Ahora se trata como lo que es: un enlace que no sirve.
import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server.js'

const { default: proxy } = await import('@/proxy')

test('un enlace con un % malformado no revienta: lleva a la pantalla y borra la cookie anterior', () => {
  const respuesta = proxy(new NextRequest('http://localhost/consultorio/abc%E0%A4%A'))

  assert.equal(respuesta.status, 307)
  assert.equal(new URL(respuesta.headers.get('location')).pathname, '/consultorio')
  const cookie = respuesta.cookies.get('turnos_consultorio')
  assert.equal(cookie?.value, '')
  assert.equal(cookie?.maxAge, 0)
})

test('un enlace bueno sigue guardando la cookie', () => {
  const respuesta = proxy(new NextRequest('http://localhost/consultorio/token-bueno'))
  assert.equal(respuesta.cookies.get('turnos_consultorio')?.value, 'token-bueno')
})

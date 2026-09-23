// Los filtros del historico entran por la URL y llegaban tal cual al
// repositorio: un `codigo` de diez mil caracteres viajaba hasta la consulta.
// Toda entrada externa se valida en el borde, con topes.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

// ANTES QUE NADA: sin esto las pruebas escriben en la base real.
await import('./repositorios-en-memoria.mjs')

const sesion = {
  user: { id: 'u-admin', name: 'Ada', usuario: 'ada', rol: 'ADMINISTRADOR', area: null, secciones: ['/admin/historico'] },
}
mock.module('@/lib/auth', { namedExports: { auth: async () => sesion } })
mock.module('@/lib/seguridad/registro', {
  namedExports: {
    registrarEvento: async () => {},
    contextoPeticion: async () => ({ ip: '10.0.0.7', agente: 'pruebas' }),
    limitarIntentos: () => ({ permitido: true, reintentarEnSegundos: 0 }),
    limpiarIntentos: () => {},
    listarEventos: async () => [],
    tiposDeEvento: async () => [],
    confiarEnProxy: false,
  },
})
mock.module('next/headers', { namedExports: { headers: async () => new Headers() } })

const { GET } = await import('@/app/api/turnos/historico/route')

const consultar = (filtros) => GET(new Request(`http://localhost/api/turnos/historico?${new URLSearchParams(filtros)}`))

test('con filtros normales responde los turnos', async () => {
  const respuesta = await consultar({ servicioId: 'srv-consulta', codigo: 'C-010', moduloId: 'mod-1', estado: 'ATENDIDO' })
  assert.equal(respuesta.status, 200)
  assert.ok(Array.isArray((await respuesta.json()).turnos))
})

test('un filtro desmedido se rechaza con 400 y un mensaje para personas', async () => {
  for (const filtros of [{ codigo: 'C'.repeat(500) }, { servicioId: 'x'.repeat(500) }, { moduloId: 'x'.repeat(500) }]) {
    const respuesta = await consultar(filtros)
    assert.equal(respuesta.status, 400, Object.keys(filtros)[0])
    assert.match((await respuesta.json()).error, /filtro/i)
  }
})

test('un estado que no existe se rechaza en vez de ignorarse en silencio', async () => {
  const respuesta = await consultar({ estado: 'BORRADO' })
  assert.equal(respuesta.status, 400)
})

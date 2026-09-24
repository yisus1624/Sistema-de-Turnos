// Los mensajes de validacion de Zod llegaban al usuario en ingles
// ("String must contain at most 60 character(s)"). Con el mapa global en
// español, lo que no trae su propio mensaje sale en español; lo que ya lo
// trae no cambia.
import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'

const { instalarMensajesEnEspanol } = await import('@/lib/validacion/mensajes-zod')
instalarMensajesEnEspanol()

const mensaje = (esquema, valor) => esquema.safeParse(valor).error?.issues[0]?.message

test('un texto demasiado largo se explica en español', () => {
  assert.equal(mensaje(z.string().max(60), 'x'.repeat(61)), 'No puede pasar de 60 caracteres.')
})

test('un texto demasiado corto y un campo que falta, en español', () => {
  assert.equal(mensaje(z.string().min(3), 'ab'), 'Debe tener al menos 3 caracteres.')
  assert.equal(mensaje(z.object({ a: z.string() }), {}), 'Falta un dato obligatorio.')
})

test('un mensaje propio del esquema se respeta', () => {
  assert.equal(mensaje(z.string().min(3, 'Muy corto.'), 'a'), 'Muy corto.')
})

test('nada de lo que sale queda en ingles', () => {
  const esquemas = [z.number(), z.enum(['A', 'B']), z.string().email(), z.number().max(2), z.boolean()]
  for (const esquema of esquemas) {
    assert.doesNotMatch(mensaje(esquema, esquema === esquemas[3] ? 5 : 'zz@') ?? '', /\b(must|Expected|Invalid|Required)\b/)
  }
})

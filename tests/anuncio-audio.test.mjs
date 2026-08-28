// Llamado por audio (requerimiento seccion 11).
import assert from 'node:assert/strict'
import test from 'node:test'

const { deletrearCodigo, textoAnuncio, elegirVoz, esVozColombiana, vocesEnEspanol, ColaDeAnuncios } =
  await import('@/lib/turnos/anuncio')

const COLOMBIANA = { name: 'Microsoft Salome Online (Natural) - Spanish (Colombia)', lang: 'es-CO' }
const ESPANOLA_NATURAL = { name: 'Microsoft Elvira Online (Natural) - Spanish (Spain)', lang: 'es-ES' }
const MEXICANA = { name: 'Microsoft Sabina - Spanish (Mexico)', lang: 'es-MX' }
const INGLESA = { name: 'Microsoft David - English (United States)', lang: 'en-US' }

test('el codigo se deletrea para entenderse en una sala ruidosa', () => {
  assert.equal(deletrearCodigo('A-014'), 'A, cero uno cuatro')
  assert.equal(deletrearCodigo('O-102'), 'O, uno cero dos')
})

test('el anuncio dice solo el turno y el destino', () => {
  const texto = textoAnuncio({
    moduloId: 'mod-consultorio-3',
    moduloNombre: 'Consultorio 3',
    servicioId: 'srv-odontologia',
    servicioNombre: 'Odontologia',
    codigo: 'O-014',
    pacienteVisible: 'LUISA C.',
  })

  assert.equal(texto, 'Turno O, cero uno cuatro. Por favor dirigirse a Consultorio 3.')
})

test('el nombre del paciente NUNCA se dice por el altavoz', () => {
  const texto = textoAnuncio({
    moduloId: 'mod-consultorio-3',
    moduloNombre: 'Consultorio 3',
    servicioId: 'srv-odontologia',
    servicioNombre: 'Odontologia',
    codigo: 'O-014',
    pacienteVisible: 'LUISA C.',
  })

  assert.equal(texto.includes('LUISA'), false)
})

test('la voz colombiana gana incluso frente a una voz neuronal de España', () => {
  assert.equal(elegirVoz([INGLESA, ESPANOLA_NATURAL, COLOMBIANA]).lang, 'es-CO')
  assert.equal(esVozColombiana(elegirVoz([INGLESA, ESPANOLA_NATURAL, COLOMBIANA])), true)
})

test('sin voz colombiana prefiere latinoamericana antes que la de España', () => {
  assert.equal(elegirVoz([ESPANOLA_NATURAL, MEXICANA]).lang, 'es-MX')
})

test('sin voces en español devuelve null, para no leer con voz extranjera', () => {
  assert.equal(elegirVoz([INGLESA]), null)
  assert.equal(esVozColombiana(null), false)
})

test('el selector lista solo las voces en español, de mejor a peor', () => {
  const lista = vocesEnEspanol([INGLESA, ESPANOLA_NATURAL, COLOMBIANA, MEXICANA])
  assert.deepEqual(
    lista.map((v) => v.lang),
    ['es-CO', 'es-MX', 'es-ES'],
  )
})

test('cuatro llamados simultaneos se anuncian completos y en orden', async () => {
  const dichos = []
  let sonando = 0

  const cola = new ColaDeAnuncios(async (texto) => {
    sonando += 1
    // Si la cola no serializara, dos locuciones se solaparian aqui.
    assert.equal(sonando, 1, 'no puede haber dos anuncios sonando a la vez')
    await new Promise((resolve) => setTimeout(resolve, 5))
    dichos.push(texto)
    sonando -= 1
  })

  const opciones = { voz: COLOMBIANA, repeticiones: 1, volumen: 1 }
  for (const codigo of ['C-001', 'O-002', 'P-003', 'A-004']) {
    cola.encolar(codigo, opciones)
  }

  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.deepEqual(dichos, ['C-001', 'O-002', 'P-003', 'A-004'])
})

test('cada anuncio se repite las veces configuradas', async () => {
  const dichos = []
  // Pausa de 5 ms en vez de los 2 s reales, para no alargar la prueba.
  const cola = new ColaDeAnuncios(async (texto) => {
    dichos.push(texto)
  }, 5)

  cola.encolar('C-001', { voz: COLOMBIANA, repeticiones: 3, volumen: 1 })
  await new Promise((resolve) => setTimeout(resolve, 80))

  assert.deepEqual(dichos, ['C-001', 'C-001', 'C-001'])
})

test('entre repeticiones del mismo turno hay una pausa, y entre turnos no', async () => {
  const momentos = []
  const PAUSA = 40

  const cola = new ColaDeAnuncios(async (texto) => {
    momentos.push({ texto, en: Date.now() })
  }, PAUSA)

  const opciones = { voz: COLOMBIANA, repeticiones: 2, volumen: 1 }
  cola.encolar('C-001', opciones)
  cola.encolar('O-002', opciones)

  await new Promise((resolve) => setTimeout(resolve, 400))

  assert.deepEqual(
    momentos.map((m) => m.texto),
    ['C-001', 'C-001', 'O-002', 'O-002'],
  )

  // Repeticion del mismo turno: espera la pausa.
  assert.ok(momentos[1].en - momentos[0].en >= PAUSA - 5)
  // Cambio de turno: arranca de inmediato.
  assert.ok(momentos[2].en - momentos[1].en < PAUSA)
})

test('sin voz en español no se anuncia nada', async () => {
  const dichos = []
  const cola = new ColaDeAnuncios(async (texto) => dichos.push(texto))

  cola.encolar('C-001', { voz: null, repeticiones: 2, volumen: 1 })
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(dichos, [])
})

test('con volumen en cero tampoco se anuncia', async () => {
  const dichos = []
  const cola = new ColaDeAnuncios(async (texto) => dichos.push(texto))

  cola.encolar('C-001', { voz: COLOMBIANA, repeticiones: 1, volumen: 0 })
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(dichos, [])
})

test('un fallo de audio no deja la cola trancada', async () => {
  const dichos = []
  let primera = true

  const cola = new ColaDeAnuncios(async (texto) => {
    if (primera) {
      primera = false
      throw new Error('fallo el audio')
    }
    dichos.push(texto)
  })

  const opciones = { voz: COLOMBIANA, repeticiones: 1, volumen: 1 }
  cola.encolar('C-001', opciones)
  cola.encolar('O-002', opciones)

  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.deepEqual(dichos, ['O-002'])
})

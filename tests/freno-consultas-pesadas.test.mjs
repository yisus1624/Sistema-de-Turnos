// Las consultas caras (historico, estadisticas, importar, purga) tienen su
// propio freno: por usuario, un tope por IP amplio y un techo global de
// consultas a la vez. Un pico o un script no puede dejar a la base sin
// conexiones para el resto del hospital.
import assert from 'node:assert/strict'
import test from 'node:test'

const { frenarConsultaPesada, crearSemaforo } = await import('@/lib/seguridad/freno-consultas')

test('el uso normal de una oficina entera no se frena', () => {
  for (let usuario = 1; usuario <= 30; usuario += 1) {
    for (let consulta = 1; consulta <= 5; consulta += 1) {
      assert.doesNotThrow(() => frenarConsultaPesada('historico', { usuarioId: `u${usuario}`, ip: '181.52.13.77' }))
    }
  }
})

test('un usuario que dispara consultas caras en bucle recibe 429', () => {
  assert.throws(
    () => {
      for (let i = 0; i < 1000; i += 1) frenarConsultaPesada('importar', { usuarioId: 'bucle', ip: '198.51.100.3' })
    },
    (error) => error.status === 429,
  )
})

test('una IP con rafagas masivas recibe 429 aunque cambie de usuario', () => {
  assert.throws(
    () => {
      for (let i = 0; i < 5000; i += 1) frenarConsultaPesada('estadisticas', { usuarioId: `u-${i}`, ip: '203.0.113.50' })
    },
    (error) => error.status === 429,
  )
})

test('el endpoint caro se frena mucho antes que el uso normal de la oficina', () => {
  let permitidas = 0
  try {
    for (;;) {
      frenarConsultaPesada('purga', { usuarioId: 'admin', ip: '198.51.100.9' })
      permitidas += 1
    }
  } catch {
    // Frenada.
  }
  assert.ok(permitidas > 0 && permitidas <= 20, `se permitieron ${permitidas}`)
})

test('el techo global de concurrencia rechaza con 503 y se libera al terminar', async () => {
  const semaforo = crearSemaforo(2)
  let soltar
  const bloqueo = new Promise((resolver) => {
    soltar = resolver
  })

  const primeras = [semaforo.ejecutar(() => bloqueo), semaforo.ejecutar(() => bloqueo)]
  await assert.rejects(() => semaforo.ejecutar(async () => 'no cabe'), (error) => error.status === 503)

  soltar('listo')
  await Promise.all(primeras)
  assert.equal(await semaforo.ejecutar(async () => 'ahora si'), 'ahora si')
})

test('mover la fecha de la vista previa no gasta el cupo de la purga real', () => {
  for (let i = 0; i < 40; i += 1) frenarConsultaPesada('purga_vista', { usuarioId: 'admin-vista', ip: '198.51.100.44' })
  assert.doesNotThrow(() => frenarConsultaPesada('purga', { usuarioId: 'admin-vista', ip: '198.51.100.44' }))
})

test('el aviso del freno dice cuanto esperar segun su ventana', () => {
  assert.throws(
    () => {
      for (let i = 0; i < 100; i += 1) frenarConsultaPesada('purga', { usuarioId: 'admin-minutos', ip: '198.51.100.45' })
    },
    (error) => /10 minutos/.test(error.message),
  )
})

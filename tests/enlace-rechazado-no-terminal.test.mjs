// La pantalla del doctor no se rinde ante un "enlace no valido".
//
// Un 401 o un 403 no siempre es un enlace vencido: un freno pasajero del
// servidor, o un intermediario (nginx, un WAF) que corta un rato. La pantalla
// lo tomaba como definitivo: apagaba el canal en vivo, no volvia a intentarlo
// nunca y dejaba al doctor en rojo con "pide un enlace nuevo" hasta que alguien
// pulsara F5, aunque su enlace siguiera sirviendo.
//
// Ahora lo sigue comprobando sola, pero SIN martillar: el reintento rapido de
// las cargas sigue sin tocar los rechazos (ver `reintento-autonomo.test.mjs`),
// y esta comprobacion va a otro ritmo, porque cada intento con un enlace
// vencido de verdad queda apuntado en el registro de seguridad.
import assert from 'node:assert/strict'
import test from 'node:test'

const { crearComprobacionPeriodica, esperaTrasRechazo } = await import('@/lib/api/reintento')

/** Un reloj de mentira: guarda lo programado para dispararlo a mano. */
function relojDePrueba() {
  const reloj = { pendientes: [] }
  reloj.programar = (accion, ms) => {
    const entrada = { accion, ms, cancelada: false }
    reloj.pendientes.push(entrada)
    return () => {
      entrada.cancelada = true
    }
  }
  reloj.dispararYEsperar = async () => {
    const entrada = reloj.pendientes.shift()
    if (entrada && !entrada.cancelada) entrada.accion()
    // Deja correr la comprobacion (una promesa) y lo que programa al terminar.
    await new Promise((listo) => setImmediate(listo))
  }
  reloj.vivos = () => reloj.pendientes.filter((p) => !p.cancelada)
  return reloj
}

test('mientras dura un rechazo pasajero, se vuelve a comprobar cada 30 a 60 segundos', () => {
  for (let intento = 0; intento < 10; intento += 1) {
    for (const azar of [0, 0.5, 0.999]) {
      const espera = esperaTrasRechazo(intento, azar)
      assert.ok(espera >= 30_000 && espera <= 60_000, `intento ${intento}: ${espera} ms`)
    }
  }
})

test('si sigue rechazado, espacia las comprobaciones pero no deja de hacerlas', () => {
  for (const intento of [10, 50, 5000]) {
    const espera = esperaTrasRechazo(intento, 0.5)
    assert.ok(espera > 60_000, `el intento ${intento} ya no va al ritmo de los primeros`)
    assert.ok(espera <= 10 * 60_000, `el intento ${intento} no espera mas de diez minutos`)
  }
})

test('tras cada comprobacion programa la siguiente: el aviso rojo ya no es definitivo', async () => {
  const reloj = relojDePrueba()
  let comprobaciones = 0
  crearComprobacionPeriodica(
    async () => {
      comprobaciones += 1
    },
    { programar: reloj.programar },
  )
  assert.equal(reloj.vivos().length, 1, 'la primera se programa en el acto')

  await reloj.dispararYEsperar()
  await reloj.dispararYEsperar()
  await reloj.dispararYEsperar()

  assert.equal(comprobaciones, 3)
  assert.equal(reloj.vivos().length, 1, 'siempre queda la siguiente en camino')
})

test('una comprobacion que falla no corta la vigilancia', async () => {
  const reloj = relojDePrueba()
  crearComprobacionPeriodica(
    async () => {
      throw new Error('Sin conexion con el servidor.')
    },
    { programar: reloj.programar },
  )

  await reloj.dispararYEsperar()

  assert.equal(reloj.vivos().length, 1)
})

test('detenida (volvio a entrar, o salio de la pantalla), no queda nada en camino', async () => {
  const reloj = relojDePrueba()
  let comprobaciones = 0
  let comprobacion = null
  comprobacion = crearComprobacionPeriodica(
    async () => {
      comprobaciones += 1
      comprobacion.detener()
    },
    { programar: reloj.programar },
  )

  await reloj.dispararYEsperar()
  await reloj.dispararYEsperar()

  assert.equal(comprobaciones, 1)
  assert.equal(reloj.vivos().length, 0, 'sin ciclos zombi despues de detenerla')
})

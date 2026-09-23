// Con el audio bloqueado por el navegador, cada llamado programaba sus dos
// osciladores sobre un contexto suspendido (con el reloj parado). Al primer
// toque sonaban TODOS a la vez, saturando, y mientras tanto se acumulaban
// nodos en memoria durante dias. Con el contexto suspendido no se programa nada.
import assert from 'node:assert/strict'
import test from 'node:test'

let osciladores = 0
class ContextoDePrueba {
  constructor() {
    this.currentTime = 0
    this.destination = {}
  }
  get state() {
    return ContextoDePrueba.estado
  }
  // Asincrono, como en el navegador: el estado cambia DESPUES de devolver.
  resume() {
    return Promise.resolve().then(() => {
      if (ContextoDePrueba.reanudable) ContextoDePrueba.estado = 'running'
    })
  }
  createOscillator() {
    osciladores += 1
    return { frequency: {}, connect: (n) => n, start() {}, stop() {} }
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n }
  }
}
ContextoDePrueba.estado = 'suspended'
ContextoDePrueba.reanudable = false
globalThis.window = { AudioContext: ContextoDePrueba }
let politica
Object.defineProperty(globalThis, 'navigator', { value: { getAutoplayPolicy: () => politica }, configurable: true })

const { sonarCampana } = await import('@/lib/turnos/anuncio')

test('con el audio bloqueado no se programa ningun sonido', () => {
  sonarCampana(0.8)
  sonarCampana(0.8)
  assert.equal(osciladores, 0)
})

test('con el audio en marcha cada llamado programa sus dos tonos', () => {
  ContextoDePrueba.estado = 'running'
  osciladores = 0
  sonarCampana(0.8)
  assert.equal(osciladores, 2)
})

test('suspendido estando PERMITIDO (volvio de segundo plano): reanuda y suena, no se pierde', async () => {
  ContextoDePrueba.estado = 'suspended'
  ContextoDePrueba.reanudable = true
  politica = 'allowed'
  osciladores = 0

  sonarCampana(0.8)
  await new Promise((resolver) => setTimeout(resolver, 0))

  assert.equal(osciladores, 2)
})

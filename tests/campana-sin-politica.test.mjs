// El televisor del kiosco (Edge/Chrome) NO tiene `navigator.getAutoplayPolicy`.
//
// Al volver de segundo plano, el navegador deja el audio suspendido. La campana
// solo se reanudaba si la politica declarada decia 'allowed', y en Chromium esa
// politica no existe: el primer llamado tras volver al frente no sonaba en la
// sala. Sin politica declarada, la pista es si el audio llego a estar en marcha
// en esta pagina: si sono antes, el navegador ya lo permitio y se puede
// reanudar sin gesto.
import assert from 'node:assert/strict'
import test from 'node:test'

let osciladores = 0
let reanudaciones = 0
class ContextoDePrueba {
  constructor() {
    this.currentTime = 0
    this.destination = {}
  }
  get state() {
    return ContextoDePrueba.estado
  }
  resume() {
    reanudaciones += 1
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
// Como Chromium: sin `getAutoplayPolicy`.
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })

const { sonarCampana, puedeReanudarseSolo } = await import('@/lib/turnos/anuncio')
const unTurnoDelReloj = () => new Promise((resolver) => setTimeout(resolver, 0))

test('sin politica declarada, se reanuda solo si el audio llego a estar en marcha', () => {
  assert.equal(puedeReanudarseSolo({ llegoAEstarEnMarcha: true }), true)
  assert.equal(puedeReanudarseSolo({ llegoAEstarEnMarcha: false }), false)
  assert.equal(puedeReanudarseSolo({ politica: 'allowed', llegoAEstarEnMarcha: false }), true, 'la politica declarada manda')
  assert.equal(puedeReanudarseSolo({ politica: 'disallowed', llegoAEstarEnMarcha: true }), false, 'la politica declarada manda')
})

test('si el audio nunca sono en esta pagina, la campana no programa nada (hace falta un toque)', async () => {
  sonarCampana(0.8)
  await unTurnoDelReloj()
  assert.equal(osciladores, 0)
})

test('tras haber sonado, al volver de segundo plano reanuda y suena el primer llamado', async () => {
  ContextoDePrueba.estado = 'running'
  sonarCampana(0.8)
  assert.equal(osciladores, 2, 'sono con el audio en marcha')

  // La pestaña paso por segundo plano y el navegador suspendio el audio.
  ContextoDePrueba.estado = 'suspended'
  ContextoDePrueba.reanudable = true
  osciladores = 0
  reanudaciones = 0

  sonarCampana(0.8)
  await unTurnoDelReloj()

  assert.ok(reanudaciones >= 1, 'pidio reanudar')
  assert.equal(osciladores, 2, 'y sono en cuanto se reanudo')
})

// Al volver la red o el primer plano se recargan los datos YA, sin esperar a
// que el canal SSE reabra: si tarda o no reabre, la pantalla seguia vieja.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

class EventSourceDePrueba {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  constructor() {
    this.readyState = EventSourceDePrueba.CONNECTING
  }
  close() {
    this.readyState = EventSourceDePrueba.CLOSED
  }
}

function objetivoDeEventos(extra = {}) {
  const oyentes = new Map()
  return {
    ...extra,
    addEventListener: (tipo, fn) => oyentes.set(tipo, fn),
    removeEventListener: (tipo) => oyentes.delete(tipo),
    disparar: (tipo) => oyentes.get(tipo)?.(),
  }
}

globalThis.EventSource = EventSourceDePrueba
globalThis.window = objetivoDeEventos()
globalThis.document = objetivoDeEventos({ visibilityState: 'visible' })

mock.timers.enable({ apis: ['setTimeout'] })
const { crearCanalEnVivo } = await import('@/lib/hooks')

function abrirCanal() {
  const cuenta = { vueltas: 0 }
  const canal = crearCanalEnVivo({
    alConectar: () => {},
    alPerderse: () => {},
    alCambiarLosDatos: () => {},
    alVolver: () => {
      cuenta.vueltas += 1
    },
  })
  return { canal, cuenta }
}

test('al volver la red se avisa para recargar sin esperar al canal', () => {
  const { canal, cuenta } = abrirCanal()
  globalThis.window.disparar('online')
  assert.equal(cuenta.vueltas, 1)
  canal.cerrar()
})

test('al volver a primer plano con el canal caido tambien', () => {
  const { canal, cuenta } = abrirCanal()
  globalThis.document.disparar('visibilitychange')
  assert.equal(cuenta.vueltas, 1)
  canal.cerrar()
})

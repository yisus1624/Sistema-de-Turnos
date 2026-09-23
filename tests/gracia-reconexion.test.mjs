// El servidor recicla cada conexion del canal cada 4-6 minutos, y el navegador
// la reabre en un segundo. Si el indicador pasara a "reconectando" en cada
// reciclado, todas las pantallas se pondrian en rojo un instante cada pocos
// minutos y el personal aprenderia a ignorar el semaforo. Solo se avisa si la
// reconexion tarda mas de unos segundos.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

const instancias = []
class EventSourceDePrueba {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  constructor() {
    this.readyState = EventSourceDePrueba.CONNECTING
    instancias.push(this)
  }
  close() {
    this.readyState = EventSourceDePrueba.CLOSED
  }
}

const sinEventos = { addEventListener() {}, removeEventListener() {} }
globalThis.EventSource = EventSourceDePrueba
globalThis.window = sinEventos
globalThis.document = { ...sinEventos, visibilityState: 'visible' }

mock.timers.enable({ apis: ['setTimeout'] })
const { crearCanalEnVivo } = await import('@/lib/hooks')

function abrirCanal() {
  const cuenta = { perdidas: 0 }
  const canal = crearCanalEnVivo({
    alConectar: () => {},
    alPerderse: () => {
      cuenta.perdidas += 1
    },
    alCambiarLosDatos: () => {},
  })
  return { canal, cuenta, fuente: instancias.at(-1) }
}

test('un reciclado que reabre en un segundo no marca "reconectando"', () => {
  const { canal, cuenta, fuente } = abrirCanal()

  fuente.onerror()
  mock.timers.tick(1000)
  fuente.onopen()
  mock.timers.tick(10_000)

  assert.equal(cuenta.perdidas, 0)
  canal.cerrar()
})

test('un corte que dura, si: y los reintentos fallidos no aplazan el aviso', () => {
  const { canal, cuenta, fuente } = abrirCanal()

  for (let segundo = 0; segundo < 5; segundo += 1) {
    fuente.onerror()
    mock.timers.tick(1000)
  }

  assert.equal(cuenta.perdidas, 1, 'avisa a los 4 s aunque el navegador reintente cada segundo')
  canal.cerrar()
})

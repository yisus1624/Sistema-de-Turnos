// Una conexion SSE muerta en silencio (el internet del hospital se corto y el
// socket quedo a medias) NO avisa a nadie. Detras de nginx ni siquiera se
// acumulan mensajes sin leer en el servidor —nginx los drena—, asi que la
// plaza del aforo seguia ocupada hasta que nginx cerraba, unos quince minutos
// despues. Tras un corte de un minuto, las pantallas que intentaban volver se
// encontraban el aforo lleno de sus propios fantasmas.
//
// El arreglo: el servidor RECICLA cada conexion cada pocos minutos. La cierra
// limpiamente; `EventSource` reconecta solo y el cliente se resincroniza al
// abrir. Ninguna conexion muerta retiene su plaza mas que ese rato.
import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as esperar } from 'node:timers/promises'

const { conexionesActivas, ocuparPlaza } = await import('@/lib/realtime/aforo')
const { abrirConexionEnVivo, msHastaReciclar, MS_RECICLADO_MINIMO, MS_RECICLADO_MAXIMO } =
  await import('@/lib/realtime/conexion')

/** Un hub de mentira: guarda al oyente y cuenta cuantas veces lo sueltan. */
function hubDePrueba() {
  const hub = { oyente: null, soltados: 0 }
  hub.suscribir = (oyente) => {
    hub.oyente = oyente
    return () => {
      hub.soltados += 1
    }
  }
  return hub
}

function abrir({ msReciclado = 60_000, hub = hubDePrueba() } = {}) {
  const reserva = ocuparPlaza(null)
  assert.equal(reserva.admitida, true)
  const stream = abrirConexionEnVivo({ plaza: reserva.plaza, suscribir: hub.suscribir, msReciclado })
  return { stream, hub }
}

async function leerHastaElFinal(stream) {
  const lector = stream.getReader()
  const decodificador = new TextDecoder()
  let texto = ''
  for (;;) {
    const { done, value } = await lector.read()
    if (done) return texto
    texto += decodificador.decode(value)
  }
}

test('el servidor recicla la conexion: la cierra y devuelve la plaza', async () => {
  const { stream, hub } = abrir({ msReciclado: 20 })
  assert.equal(conexionesActivas(), 1)

  await leerHastaElFinal(stream)

  assert.equal(conexionesActivas(), 0)
  assert.equal(hub.soltados, 1, 'al reciclar se suelta la suscripcion al hub')
})

test('una conexion colgada no retiene la plaza mas alla del reciclado', async () => {
  process.env.TURNOS_MAX_CANAL_EN_VIVO = '2'
  try {
    // Nadie las lee: son las pantallas que se quedaron al otro lado del corte.
    abrir({ msReciclado: 30 })
    abrir({ msReciclado: 30 })
    assert.equal(ocuparPlaza(null).admitida, false, 'con el aforo lleno de fantasmas no cabe nadie')

    await esperar(80)

    const reconexion = ocuparPlaza(null)
    assert.equal(reconexion.admitida, true, 'pasado el reciclado, la pantalla que vuelve entra')
    reconexion.plaza.soltar()
    assert.equal(conexionesActivas(), 0)
  } finally {
    delete process.env.TURNOS_MAX_CANAL_EN_VIVO
  }
})

test('el saludo le pide al navegador reconectar rapido tras el reciclado', async () => {
  const { stream } = abrir({ msReciclado: 10 })
  const texto = await leerHastaElFinal(stream)
  assert.match(texto, /^retry: \d+\n/)
})

test('los eventos del hub llegan por la conexion mientras esta abierta', async () => {
  const hub = hubDePrueba()
  const { stream } = abrir({ msReciclado: 30, hub })
  hub.oyente({ tipo: 'modulo.liberado', moduloId: 'mod-1' })

  const texto = await leerHastaElFinal(stream)
  assert.match(texto, /data: \{"tipo":"modulo.liberado","moduloId":"mod-1"\}/)
})

test('si el cliente cierra, se suelta todo una sola vez', async () => {
  const { stream, hub } = abrir()
  await stream.cancel()

  assert.equal(conexionesActivas(), 0)
  assert.equal(hub.soltados, 1)
})

test('el momento del reciclado varia para que el hospital no reconecte a la vez', () => {
  const temprano = msHastaReciclar(0)
  const tarde = msHastaReciclar(0.999)

  assert.equal(temprano, MS_RECICLADO_MINIMO)
  assert.ok(tarde > temprano && tarde <= MS_RECICLADO_MAXIMO)
})

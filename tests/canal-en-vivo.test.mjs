// El canal de eventos en vivo puede morir EN SILENCIO.
//
// Un SSE cortado por un NAT, un firewall o un proxy que bufferea deja el socket
// abierto y sin trafico: el navegador nunca llama a `onerror`, el indicador
// sigue verde y la fila se congela. El doctor llama "al siguiente" sobre una
// lista vieja sin ninguna senal de que algo va mal.
//
// La red de seguridad es el latido: el servidor lo manda COMO EVENTO CON DATOS
// (un comentario SSE no llega a `onmessage`, asi que el cliente no puede
// notarlo), y el cliente da la conexion por muerta si se queda sin recibir
// nada durante varios latidos seguidos.
import assert from 'node:assert/strict'
import test from 'node:test'

const {
  LATIDO,
  MS_LATIDO,
  MS_SILENCIO_MAXIMO,
  afectaALaFila,
  esCambioDeDatos,
  formatearMensajeSse,
  interpretarMensaje,
} = await import('@/lib/realtime/canal')

const LLAMADO = {
  tipo: 'turno.llamado',
  casilla: { moduloId: 'mod-1', modulo: 'Consultorio 1', codigo: 'A-001', profesional: null, servicio: null, llamadoEn: null },
  repetido: false,
}

test('el latido viaja como evento con datos, no como comentario SSE', () => {
  const trama = formatearMensajeSse(LATIDO)

  assert.ok(trama.startsWith('data: '), 'un comentario SSE nunca llegaria a onmessage del cliente')
  assert.ok(trama.endsWith('\n\n'))
})

test('el cliente puede interpretar el latido que le llega', () => {
  const [, payload] = formatearMensajeSse(LATIDO).trimEnd().split('data: ')

  assert.deepEqual(interpretarMensaje(payload), { tipo: 'latido' })
})

test('el latido no es un cambio de datos: no debe disparar recargas', () => {
  assert.equal(esCambioDeDatos(LATIDO), false)
  assert.equal(esCambioDeDatos(LLAMADO), true)
})

test('un mensaje que no es JSON no rompe al cliente', () => {
  assert.equal(interpretarMensaje('ping'), null)
})

test('el silencio tolerado cubre varios latidos seguidos, pero no minutos', () => {
  assert.ok(
    MS_SILENCIO_MAXIMO > MS_LATIDO * 3,
    'perder un latido por un hipo de la red no puede reconectar a todo el hospital',
  )
  assert.ok(
    MS_SILENCIO_MAXIMO <= 70000,
    'mas de eso y la fila del consultorio se queda vieja demasiado tiempo',
  )
})

test('solo recarga por la fila propia; lo demas pasa siempre', () => {
  const cambio = { tipo: 'fila.cambiada', servicioId: 'srv-1', profesionalId: 'pro-1' }

  assert.equal(afectaALaFila(cambio, { servicioId: 'srv-1' }), true)
  assert.equal(afectaALaFila(cambio, { servicioId: 'srv-2' }), false)
  assert.equal(afectaALaFila(cambio, { profesionalId: 'pro-1' }), true)
  assert.equal(afectaALaFila(cambio, { profesionalId: 'pro-2' }), false)
  assert.equal(afectaALaFila(LLAMADO, { servicioId: 'srv-2' }), true)
})

// Cada llamado de CUALQUIER consultorio hacia recargar a TODOS los demas: con
// ocho consultorios trabajando, la pantalla de cada doctor pedia su fila ocho
// veces por cada paciente que pasaba. Y la fila de un doctor son SUS pacientes:
// que el de al lado llame al suyo no se la mueve.
test('el llamado de otro consultorio no obliga a recargar la fila propia', () => {
  const deOtro = { ...LLAMADO, casilla: { ...LLAMADO.casilla, moduloId: 'mod-8' } }

  assert.equal(afectaALaFila(deOtro, { moduloId: 'mod-1' }), false)
  assert.equal(
    afectaALaFila(LLAMADO, { moduloId: 'mod-1' }),
    true,
    'el llamado del propio consultorio si: acaba de salir un paciente de la fila',
  )
})

test('quien no dice en que consultorio esta sigue recibiendo todos los llamados', () => {
  // La ventanilla comparte fila: que otra ventanilla llame al siguiente SI le
  // quita gente de la suya. Sin consultorio declarado no se filtra nada.
  assert.equal(afectaALaFila(LLAMADO, { servicioId: 'srv-2' }), true)
  assert.equal(afectaALaFila(LLAMADO, {}), true)
})

test('un consultorio que queda libre le llega a todo el mundo', () => {
  // La pantalla del televisor tiene que apagar esa casilla se mire desde donde
  // se mire; no se filtra por fila.
  const liberado = { tipo: 'modulo.liberado', moduloId: 'mod-8' }

  assert.equal(afectaALaFila(liberado, { moduloId: 'mod-1' }), true)
})

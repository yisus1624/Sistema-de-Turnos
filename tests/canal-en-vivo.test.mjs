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
  cambiaLosCatalogos,
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

// El televisor NO pasa por este filtro: aplica cada evento a su casilla (ver
// `app/pantalla/page.tsx`), asi que apaga la casilla liberada igual. El filtro
// es para las pantallas que recargan su fila entera.
// Cada "Atendido" de cualquier consultorio publica `modulo.liberado`, y ese
// evento hacia recargar a TODOS los consultorios: doce recargas pesadas por
// cada paciente que salia, cada una escribiendo en la base. A un consultorio
// solo le interesa que se libere EL SUYO.
test('que otro consultorio quede libre no obliga a recargar', () => {
  const liberado = { tipo: 'modulo.liberado', moduloId: 'mod-8' }

  assert.equal(afectaALaFila(liberado, { profesionalId: 'pro-1', moduloId: 'mod-3' }), false)
  assert.equal(afectaALaFila(liberado, { profesionalId: 'pro-1', moduloId: 'mod-8' }), true)
  assert.equal(afectaALaFila(liberado, { profesionalId: 'pro-1', moduloId: null }), true, 'sin modulo, por si acaso')
  assert.equal(afectaALaFila(liberado, { servicioId: 'srv-1' }), true, 'la ventanilla no declara modulo')
})

// El doctor llamo a T desde el consultorio A, cambio el selector a B y
// admision cerro a T: el `modulo.liberado` de A se descartaba porque solo se
// comparaba con B, y la pantalla del doctor seguia mostrando a T abierto.
test('la liberacion del consultorio del turno abierto pasa aunque el selector este en otro', () => {
  const liberado = { tipo: 'modulo.liberado', moduloId: 'mod-A' }
  const fila = { profesionalId: 'pro-1', moduloId: 'mod-B', moduloDelTurnoAbierto: 'mod-A' }

  assert.equal(afectaALaFila(liberado, fila), true)
  assert.equal(afectaALaFila({ tipo: 'modulo.liberado', moduloId: 'mod-C' }, fila), false, 'un tercero sigue sin importar')
  assert.equal(afectaALaFila(liberado, { ...fila, moduloDelTurnoAbierto: null }), false, 'sin turno abierto, solo el selector')
})

// Los eventos generales tienen que pasar el filtro de cualquier fila: sin
// ellos, un cambio de catalogos o una purga dejaba las pantallas con datos
// que ya no existen.
test('los eventos generales y los cambios de fila sin profesional pasan el filtro', () => {
  const sinProfesional = { tipo: 'fila.cambiada', servicioId: 'srv-1', profesionalId: null }
  assert.deepEqual(interpretarMensaje(JSON.stringify(sinProfesional)), sinProfesional)
  assert.equal(afectaALaFila(sinProfesional, { servicioId: 'srv-1' }), true)
  for (const tipo of ['configuracion.cambiada', 'datos.reiniciados']) {
    assert.deepEqual(interpretarMensaje(JSON.stringify({ tipo })), { tipo })
    assert.equal(afectaALaFila({ tipo }, { profesionalId: 'pro-1', moduloId: 'mod-1' }), true, tipo)
    assert.equal(afectaALaFila({ tipo }, { servicioId: 'srv-9' }), true, tipo)
  }
})

// El monitor del administrador pedia los catalogos una sola vez al abrir:
// un servicio creado o una purga no aparecian hasta recargar la pagina.
test('solo la configuracion y el reinicio de datos cambian los catalogos', () => {
  assert.equal(cambiaLosCatalogos({ tipo: 'configuracion.cambiada' }), true)
  assert.equal(cambiaLosCatalogos({ tipo: 'datos.reiniciados' }), true)
  assert.equal(cambiaLosCatalogos(LLAMADO), false)
  assert.equal(cambiaLosCatalogos({ tipo: 'modulo.liberado', moduloId: 'mod-1' }), false)
  assert.equal(cambiaLosCatalogos({ tipo: 'fila.cambiada', servicioId: 's', profesionalId: null }), false)
})

// El mensaje del canal se aceptaba tal cual (`as MensajeEnVivo`). Un evento
// con otra forma —de una version distinta del servidor durante un despliegue,
// o simplemente roto— llegaba a la pantalla y reventaba al leer
// `casilla.moduloId`. Ahora se valida el tipo y los campos que se usan, y lo
// desconocido se descarta.
test('un mensaje con la forma correcta se acepta', () => {
  const llamado = {
    tipo: 'turno.llamado',
    repetido: false,
    casilla: { moduloId: 'm1', moduloNombre: 'CONS 1', servicioId: 's', servicioNombre: 'CE', codigo: 'C-001', horaLlamado: '2026-09-22T14:00:00.000Z', vecesLlamado: 1 },
  }
  assert.deepEqual(interpretarMensaje(JSON.stringify(llamado)), llamado)
  assert.deepEqual(interpretarMensaje(JSON.stringify({ tipo: 'modulo.liberado', moduloId: 'm1' })), { tipo: 'modulo.liberado', moduloId: 'm1' })
  assert.deepEqual(interpretarMensaje(JSON.stringify({ tipo: 'latido' })), { tipo: 'latido' })
})

test('un mensaje de tipo desconocido o con campos que faltan se descarta', () => {
  assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'algo.nuevo' })), null)
  assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'turno.llamado', repetido: false })), null)
  assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'turno.llamado', repetido: false, casilla: { moduloId: 7 } })), null)
  assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'modulo.liberado' })), null)
  assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'fila.cambiada', servicioId: 's' })), null)
  assert.equal(interpretarMensaje('null'), null)
  assert.equal(interpretarMensaje('[1,2]'), null)
  assert.equal(interpretarMensaje('no es json'), null)
})

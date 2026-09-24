// El televisor al ponerse al dia con puestos de verdad (consultorio~doctor).
//
// La casilla LIBRE llega sin `puesto` (clave "c1") y la OCUPADA con puesto
// (clave "c1~p1"). Al comparar solo por clave, la foto no encontraba la casilla
// previa: un llamado perdido durante un hueco del canal aparecia SIN campana ni
// resalte, y un "Atendido" llegado mientras la foto viajaba dejaba pintado
// hasta un minuto un turno ya cerrado.
import assert from 'node:assert/strict'
import test from 'node:test'

const { mezclarFotoDePantalla } = await import('@/lib/turnos/mezcla-pantalla')

const AHORA = Date.parse('2026-09-22T15:00:00.000Z')
const hace = (ms) => new Date(AHORA - ms).toISOString()

function libre(moduloId) {
  return { moduloId, moduloNombre: moduloId, servicioId: 's', servicioNombre: 'CE', codigo: null, horaLlamado: null, vecesLlamado: 0 }
}
function ocupada(moduloId, doctor, codigo, msAtras = 20_000) {
  return { ...libre(moduloId), puesto: `${moduloId}~${doctor}`, codigo, horaLlamado: hace(msAtras), vecesLlamado: 1 }
}
const codigos = (casillas) => casillas.map((c) => [c.puesto ?? c.moduloId, c.codigo])

test('un llamado perdido en un consultorio que estaba Libre suena y se resalta', () => {
  const { casillas, llamadosNuevos } = mezclarFotoDePantalla([libre('c1')], [ocupada('c1', 'p1', 'A-002')], new Set(), AHORA)

  assert.deepEqual(codigos(casillas), [['c1~p1', 'A-002']])
  assert.deepEqual(llamadosNuevos, ['c1~p1'])
})

test('un llamado perdido de OTRO doctor del mismo consultorio tambien suena', () => {
  const previas = [ocupada('c1', 'p1', 'A-001', 600_000)]
  const { llamadosNuevos } = mezclarFotoDePantalla(previas, [ocupada('c1', 'p2', 'B-100')], new Set(), AHORA)

  assert.deepEqual(llamadosNuevos, ['c1~p2'])
})

test('Atendido / No se presento / Retroceder durante el viaje: la foto vieja no repinta el turno cerrado', () => {
  // El evento libero c1~p1 y lo pintado quedo como la casilla libre "c1".
  const { casillas, llamadosNuevos } = mezclarFotoDePantalla(
    [libre('c1')],
    [ocupada('c1', 'p1', 'A-001')],
    new Set(['c1~p1']),
    AHORA,
  )

  assert.deepEqual(codigos(casillas), [['c1', null]])
  assert.deepEqual(llamadosNuevos, [])
})

test('un llamado durante el viaje no lo borra la foto vieja que aun traia la casilla libre', () => {
  const pintada = ocupada('c1', 'p1', 'A-002', 500)
  const { casillas, llamadosNuevos } = mezclarFotoDePantalla([pintada], [libre('c1')], new Set(['c1~p1']), AHORA)

  assert.deepEqual(codigos(casillas), [['c1~p1', 'A-002']])
  assert.deepEqual(llamadosNuevos, [], 'ya sono con el evento')
})

test('varios doctores: se cierra uno durante el viaje y el otro sigue como dice la foto', () => {
  const { casillas } = mezclarFotoDePantalla(
    [ocupada('c1', 'p2', 'B-001')],
    [ocupada('c1', 'p1', 'A-001'), ocupada('c1', 'p2', 'B-001')],
    new Set(['c1~p1']),
    AHORA,
  )

  assert.deepEqual(codigos(casillas), [['c1~p2', 'B-001']])
})

test('si el unico puesto que traia la foto se cerro durante el viaje, el consultorio queda libre', () => {
  const { casillas } = mezclarFotoDePantalla(
    [ocupada('c1', 'p1', 'A-001', 600_000)],
    [ocupada('c1', 'p2', 'B-001')],
    new Set(['c1~p2']),
    AHORA,
  )

  assert.deepEqual(codigos(casillas), [['c1', null]])
})

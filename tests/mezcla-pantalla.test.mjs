// Como se pone al dia el televisor despues de un corte de red.
//
// El fallo real: con la red lenta, la foto completa que se pide al reconectar
// se descartaba entera si en el camino llegaba cualquier evento, y el televisor
// se quedaba mostrando al paciente anterior. Ademas los llamados ocurridos
// durante el corte aparecian sin campana.
import assert from 'node:assert/strict'
import test from 'node:test'

const { mezclarFotoDePantalla, MS_LLAMADO_RECIENTE } = await import('@/lib/turnos/mezcla-pantalla')

const AHORA = Date.parse('2026-09-22T15:00:00.000Z')
const hace = (ms) => new Date(AHORA - ms).toISOString()

function casilla(moduloId, cambios = {}) {
  return {
    moduloId,
    moduloNombre: moduloId,
    servicioId: 'srv',
    servicioNombre: 'Consulta externa',
    codigo: null,
    horaLlamado: null,
    vecesLlamado: 0,
    ...cambios,
  }
}

test('la foto reemplaza lo pintado cuando nadie toco nada durante el viaje', () => {
  const previas = [casilla('c1', { codigo: 'A-001', horaLlamado: hace(600000), vecesLlamado: 1 })]
  const foto = [casilla('c1', { codigo: 'A-002', horaLlamado: hace(1000), vecesLlamado: 1 })]

  const { casillas } = mezclarFotoDePantalla(previas, foto, new Set(), AHORA)

  assert.equal(casillas[0].codigo, 'A-002')
})

test('un evento de OTRO consultorio no hace descartar la foto', () => {
  const previas = [casilla('c1', { codigo: 'A-001' }), casilla('c2', { codigo: 'B-001' })]
  const eventoC2 = casilla('c2', { codigo: 'B-002', horaLlamado: hace(100), vecesLlamado: 1 })
  previas[1] = eventoC2
  const foto = [
    casilla('c1', { codigo: 'A-002', horaLlamado: hace(2000), vecesLlamado: 1 }),
    casilla('c2', { codigo: 'B-001' }),
  ]

  const { casillas } = mezclarFotoDePantalla(previas, foto, new Set(['c2']), AHORA)

  assert.equal(casillas[0].codigo, 'A-002', 'c1 se pone al dia con la foto')
  assert.equal(casillas[1].codigo, 'B-002', 'c2 conserva el evento, que es mas nuevo que la foto')
})

test('un llamado ocurrido durante el corte se anuncia', () => {
  const previas = [casilla('c1', { codigo: 'A-001', horaLlamado: hace(900000), vecesLlamado: 1 })]
  const foto = [casilla('c1', { codigo: 'A-002', horaLlamado: hace(30000), vecesLlamado: 1 })]

  const { llamadosNuevos } = mezclarFotoDePantalla(previas, foto, new Set(), AHORA)

  assert.deepEqual(llamadosNuevos, ['c1'])
})

test('un rellamado del mismo turno durante el corte tambien se anuncia', () => {
  const previas = [casilla('c1', { codigo: 'A-001', horaLlamado: hace(200000), vecesLlamado: 1 })]
  const foto = [casilla('c1', { codigo: 'A-001', horaLlamado: hace(20000), vecesLlamado: 2 })]

  const { llamadosNuevos } = mezclarFotoDePantalla(previas, foto, new Set(), AHORA)

  assert.deepEqual(llamadosNuevos, ['c1'])
})

test('lo que no cambio no suena', () => {
  const igual = casilla('c1', { codigo: 'A-001', horaLlamado: hace(20000), vecesLlamado: 1 })

  const { llamadosNuevos } = mezclarFotoDePantalla([igual], [{ ...igual }], new Set(), AHORA)

  assert.deepEqual(llamadosNuevos, [])
})

test('un llamado viejo se pinta pero no suena', () => {
  const previas = [casilla('c1')]
  const foto = [casilla('c1', { codigo: 'A-009', horaLlamado: hace(MS_LLAMADO_RECIENTE + 1000), vecesLlamado: 1 })]

  const { casillas, llamadosNuevos } = mezclarFotoDePantalla(previas, foto, new Set(), AHORA)

  assert.equal(casillas[0].codigo, 'A-009')
  assert.deepEqual(llamadosNuevos, [])
})

test('la primera carga del televisor no suena', () => {
  const foto = [casilla('c1', { codigo: 'A-001', horaLlamado: hace(1000), vecesLlamado: 1 })]

  const { casillas, llamadosNuevos } = mezclarFotoDePantalla([], foto, new Set(), AHORA)

  assert.equal(casillas.length, 1)
  assert.deepEqual(llamadosNuevos, [])
})

test('un consultorio nuevo en la foto aparece aunque otro haya recibido eventos', () => {
  const previas = [casilla('c1', { codigo: 'A-003' })]
  const foto = [casilla('c1', { codigo: 'A-002' }), casilla('c9')]

  const { casillas } = mezclarFotoDePantalla(previas, foto, new Set(['c1']), AHORA)

  assert.deepEqual(casillas.map((c) => [c.moduloId, c.codigo]), [['c1', 'A-003'], ['c9', null]])
})

// --- Correcciones de QA -----------------------------------------------------

const { decidirLlamadoEnVivo } = await import('@/lib/turnos/mezcla-pantalla')

test('un rellamado con la misma hora pero otro conteo se anuncia', () => {
  const hora = hace(20000)
  const previas = [casilla('c1', { codigo: 'A-001', horaLlamado: hora, vecesLlamado: 1 })]
  const foto = [casilla('c1', { codigo: 'A-001', horaLlamado: hora, vecesLlamado: 2 })]

  assert.deepEqual(mezclarFotoDePantalla(previas, foto, new Set(), AHORA).llamadosNuevos, ['c1'])
})

test('un rellamado con otra hora y el mismo conteo tambien se anuncia', () => {
  const previas = [casilla('c1', { codigo: 'A-001', horaLlamado: hace(90000), vecesLlamado: 2 })]
  const foto = [casilla('c1', { codigo: 'A-001', horaLlamado: hace(10000), vecesLlamado: 2 })]

  assert.deepEqual(mezclarFotoDePantalla(previas, foto, new Set(), AHORA).llamadosNuevos, ['c1'])
})

test('el consultorio tocado durante el viaje no se anuncia desde la foto', () => {
  const previas = [casilla('c1', { codigo: 'A-001', horaLlamado: hace(90000), vecesLlamado: 1 })]
  const foto = [casilla('c1', { codigo: 'A-002', horaLlamado: hace(1000), vecesLlamado: 1 })]

  assert.deepEqual(mezclarFotoDePantalla(previas, foto, new Set(['c1']), AHORA).llamadosNuevos, [])
})

test('una hora de llamado en el futuro no suena (reloj descuadrado)', () => {
  const previas = [casilla('c1')]
  const futuro = new Date(AHORA + 10 * 60 * 1000).toISOString()
  const foto = [casilla('c1', { codigo: 'A-005', horaLlamado: futuro, vecesLlamado: 1 })]

  assert.deepEqual(mezclarFotoDePantalla(previas, foto, new Set(), AHORA).llamadosNuevos, [])
})

test('un consultorio que quedo libre se pinta libre y no suena', () => {
  const previas = [casilla('c1', { codigo: 'A-001', horaLlamado: hace(20000), vecesLlamado: 1 })]
  const foto = [casilla('c1')]

  const { casillas, llamadosNuevos } = mezclarFotoDePantalla(previas, foto, new Set(), AHORA)

  assert.equal(casillas[0].codigo, null)
  assert.deepEqual(llamadosNuevos, [])
})

test('los llamados de la foto salen en orden de hora: el ultimo es el mas reciente', () => {
  const previas = [casilla('c1'), casilla('c2')]
  const foto = [
    casilla('c1', { codigo: 'A-001', horaLlamado: hace(1000), vecesLlamado: 1 }),
    casilla('c2', { codigo: 'B-001', horaLlamado: hace(60000), vecesLlamado: 1 }),
  ]

  assert.deepEqual(mezclarFotoDePantalla(previas, foto, new Set(), AHORA).llamadosNuevos, ['c2', 'c1'])
})

test('el evento de un llamado que la foto ya habia pintado reemplaza sin volver a sonar', () => {
  // La resincronizacion leyo la base entre el commit del llamado y la
  // publicacion del evento: la foto ya lo trajo, y sono. El evento no suena
  // otra vez.
  const pintada = casilla('c1', { codigo: 'A-003', horaLlamado: hace(500), vecesLlamado: 1 })

  assert.equal(decidirLlamadoEnVivo(pintada, { ...pintada }), 'reemplazar_en_silencio')
  assert.equal(decidirLlamadoEnVivo(pintada, { ...pintada, vecesLlamado: 2 }), 'anunciar')
  assert.equal(decidirLlamadoEnVivo(undefined, pintada), 'anunciar')
})

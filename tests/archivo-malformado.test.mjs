// Un .xlsx corrupto o un XML con una entidad imposible tumbaban la carga con
// un 500 ("problema del sistema"). Ahora el lector devuelve un motivo claro,
// que la ruta convierte en un 400 para el funcionario.
import assert from 'node:assert/strict'
import test from 'node:test'

const { leerReporteDelHospital } = await import('@/lib/citas/reporte-hospital')

test('un .xlsx corrupto no lanza: explica que el Excel esta dañado', async () => {
  const corrupto = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  const { filas, errores } = await leerReporteDelHospital(corrupto)
  assert.equal(filas.length, 0)
  assert.match(errores[0].motivo, /Excel/)
})

test('un XML con una entidad invalida no lanza: explica que el XML esta dañado', async () => {
  const xml = '<Report><Detalles fecha_inicio="2026-09-22" nombre_paciente="A &#99999999; B" /></Report>'
  const { filas, errores } = await leerReporteDelHospital(new TextEncoder().encode(xml))
  assert.equal(filas.length, 0)
  assert.match(errores[0].motivo, /XML/)
})

// Un .xlsx grande no puede congelar el servidor.
//
// ExcelJS carga el libro entero en memoria y en el hilo principal, y el tope de
// 20 000 filas se miraba DESPUES: un Excel de 9,4 MB (300 000 filas) bloqueaba
// el hilo 9,5 s y pedia hasta 2 GB, con el televisor, los llamados y las
// llegadas sin responder. Ahora el .xlsx tiene su propio tope de bytes,
// coherente con 20 000 filas, y se rechaza antes de abrirlo.
import assert from 'node:assert/strict'
import test from 'node:test'

const { leerReporteDelHospital, MAXIMO_BYTES_XLSX } = await import('@/lib/citas/reporte-hospital')

test('un .xlsx por encima del tope se rechaza sin abrirlo, con un motivo claro', async () => {
  // Firma de ZIP y relleno: si se intentara abrir, ExcelJS fallaria.
  const bytes = new Uint8Array(MAXIMO_BYTES_XLSX + 1)
  bytes.set([0x50, 0x4b, 0x03, 0x04])

  const { filas, errores } = await leerReporteDelHospital(bytes)

  assert.equal(filas.length, 0)
  assert.equal(errores.length, 1)
  assert.match(errores[0].motivo, /MB/)
  assert.match(errores[0].motivo, /XML/)
})

test('el tope del .xlsx es mucho menor que el del XML', () => {
  assert.ok(MAXIMO_BYTES_XLSX <= 2 * 1024 * 1024)
})

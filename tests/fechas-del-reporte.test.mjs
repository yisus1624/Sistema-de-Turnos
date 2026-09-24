// Una fecha imposible en el reporte del hospital no puede tumbar la carga.
//
// `normalizarFecha` armaba AAAA-MM-DD sin mirar si ese dia existe, y despues
// `new Date(...).toISOString()` lanzaba un RangeError. Con UNA sola fila con
// "32/09/2026" o "09/14/2026" (el mes primero), la ruta respondia 500: no
// entraba ninguna de las otras trescientas citas, no quedaba rastro en
// CargaCitas y nadie sabia que fila era. Y "31/02/2026" pasaba en silencio: la
// cita quedaba en un dia que no existe y no salia ni en la agenda ni en
// admisiones.
import assert from 'node:assert/strict'
import test from 'node:test'

import { base, filaDelReporte, reporteXml, vaciarBase } from './base-falsa-de-carga.mjs'

const { leerReporteEnFilas, leerReporteXml, normalizarFecha } = await import('@/lib/citas/reporte-hospital')
const { importarReporteDeCitas } = await import('@/lib/citas/importar-reporte')

const decodificar = (bytes) => new TextDecoder().decode(bytes)

/** Un dia normal del hospital: trescientas citas buenas y UNA mala en medio. */
function diaConUnaFechaMala(fechaMala, posicion = 181) {
  const filas = Array.from({ length: 300 }, (_, i) => filaDelReporte({ documento: String(5000 + i) }))
  filas.splice(posicion - 1, 0, filaDelReporte({ documento: '9999', fecha: fechaMala }))
  return decodificar(reporteXml(filas))
}

for (const fechaMala of ['32/09/2026', '09/14/2026', '15/00/2026']) {
  test(`"${fechaMala}" se rechaza en su fila y las otras trescientas se leen`, () => {
    const { filas, errores } = leerReporteXml(diaConUnaFechaMala(fechaMala))

    assert.equal(filas.length, 300, 'las citas buenas no se pierden por la mala')
    assert.equal(errores.length, 1)
    assert.equal(errores[0].fila, 181, 'se dice que fila corregir')
    assert.ok(errores[0].motivo.includes(fechaMala), 'el motivo trae la fecha tal como venia')
  })
}

test('el 31 de febrero no entra en silencio a un dia que no existe', () => {
  assert.equal(normalizarFecha('31/02/2026'), null)

  const { filas, errores } = leerReporteXml(diaConUnaFechaMala('31/02/2026', 1))
  assert.equal(filas.length, 300)
  assert.equal(errores[0].fila, 1)
})

test('el motivo le dice al funcionario en que orden tiene que venir la fecha', () => {
  const { errores } = leerReporteXml(diaConUnaFechaMala('09/14/2026'))
  assert.match(errores[0].motivo, /no existe/i)
  assert.match(errores[0].motivo, /DD\/MM\/AAAA/)
})

test('el 29 de febrero existe solo en los bisiestos', () => {
  assert.equal(normalizarFecha('29/02/2028'), '2028-02-29')
  assert.equal(normalizarFecha('29/02/2026'), null)
})

test('la forma AAAA-MM-DD tambien se comprueba contra el calendario', () => {
  assert.equal(normalizarFecha('2026-02-28'), '2026-02-28')
  assert.equal(normalizarFecha('2026-02-30'), null)
  assert.equal(normalizarFecha('2026-13-01'), null)
})

test('en el Excel, la fila rechazada es la de la hoja, contando el titulo', () => {
  const hoja = [
    ['Citas asignadas'],
    [],
    ['Fecha', 'Hora', 'Documento', 'Nombre Paciente', 'Nombre prof.'],
    ['14/09/2026', '07:00', '1001', 'PACIENTE UNO', 'DRA PRUEBA'],
    ['31/09/2026', '07:15', '1002', 'PACIENTE DOS', 'DRA PRUEBA'],
    ['14/09/2026', '07:30', '1003', 'PACIENTE TRES', 'DRA PRUEBA'],
  ]

  const { filas, errores } = leerReporteEnFilas(hoja)

  assert.equal(filas.length, 2)
  assert.deepEqual(errores.map((e) => e.fila), [5])
})

test('la carga entra entera menos la fila mala, y queda el rastro de cual fue', async () => {
  vaciarBase()
  const datos = reporteXml([
    filaDelReporte({ documento: '1001', hora: '07:10' }),
    filaDelReporte({ documento: '1002', hora: '07:20' }),
    filaDelReporte({ documento: '1003', hora: '07:30', fecha: '32/12/2030' }),
    filaDelReporte({ documento: '1004', hora: '07:40' }),
  ])

  const resumen = await importarReporteDeCitas({ archivo: 'agenda.xml', datos })

  assert.equal(resumen.creadas, 3)
  assert.deepEqual(resumen.errores.map((e) => e.fila), [3])
  assert.deepEqual(base.cita.map((c) => c.documentoPaciente).sort(), ['1001', '1002', '1004'])

  // Al dia siguiente, cuando el paciente reclame, el rastro dice que fila fue.
  assert.equal(base.cargaCitas.length, 1)
  assert.deepEqual(base.cargaCitas[0].errores.map((e) => e.fila), [3])
})

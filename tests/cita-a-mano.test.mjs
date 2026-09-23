// La cita que se agenda a mano cae en el dia de la celda que se abrio.
//
// `agendar()` leia la fecha del selector en el momento de GUARDAR. Con el
// modal abierto al pasar la medianoche, el selector (que sigue a "hoy") ya
// marcaba el dia siguiente y la cita quedaba para mañana: el operador habia
// elegido las 4 p. m. de HOY y nada en la pantalla se lo decia.
import assert from 'node:assert/strict'
import test from 'node:test'

const { celdaDeAgenda, solicitudDeCita } = await import('@/lib/citas/cita-a-mano')

const PROFESIONAL = { id: 'pro-1', nombre: 'DRA. ANA RUIZ' }
const PACIENTE = { documento: '1234567', nombre: 'PACIENTE DE PRUEBA' }

test('la cita se agenda para el dia en que se abrio la celda, sin importar cuando se guarde', () => {
  const celda = celdaDeAgenda('2026-09-23', PROFESIONAL, '16:00')

  const solicitud = solicitudDeCita(celda, PACIENTE)

  assert.equal(solicitud.horaCita, '2026-09-23T21:00:00.000Z', '4 p. m. en Colombia (UTC-5) del dia de la celda')
  assert.equal(solicitud.profesionalId, 'pro-1')
  assert.equal(solicitud.documentoPaciente, '1234567')
  assert.equal(solicitud.nombrePaciente, 'PACIENTE DE PRUEBA')
})

test('una cita de la noche en Colombia no se corre de dia aunque en UTC ya sea mañana', () => {
  // Las 8 p. m. del 31 de diciembre en Colombia son la 1 a. m. del 1 de enero
  // en UTC: la cita tiene que seguir siendo del dia de la celda.
  const celda = celdaDeAgenda('2026-12-31', PROFESIONAL, '20:00')

  assert.equal(solicitudDeCita(celda, PACIENTE).horaCita, '2027-01-01T01:00:00.000Z')
})

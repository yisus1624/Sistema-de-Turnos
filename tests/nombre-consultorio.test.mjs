// En el televisor, "CONS 01- CONSULTA EXTERNA" se lee en dos partes: el lugar
// ("CONSULTA EXTERNA") y, aparte y grande, el numero ("1").
import assert from 'node:assert/strict'
import test from 'node:test'

const { partesDeConsultorio: partes, nombreDeConsultorioEnPantalla: enCuadricula, conNombresDePantalla, leerLugarYNumero } =
  await import('@/lib/turnos/nombre-consultorio')

test('el lugar es el servicio y el numero va aparte', () => {
  assert.deepEqual(partes('CONS 01- CONSULTA EXTERNA', 'Consulta externa'), { lugar: 'CONSULTA EXTERNA', numero: '1' })
  assert.deepEqual(partes('CONS 01- ODONTOLOGIA', 'Odontologia'), { lugar: 'ODONTOLOGIA', numero: '1' })
  assert.deepEqual(partes('CONS 10 - ODONTOLOGÍA', 'Odontología'), { lugar: 'ODONTOLOGIA', numero: '10' })
})

test('lo que distingue al consultorio, ademas del servicio, se conserva en el lugar', () => {
  assert.deepEqual(partes('CONS 02 - ODONTOLOGIA PYM', 'Odontologia'), { lugar: 'ODONTOLOGIA PYM', numero: '2' })
  assert.deepEqual(partes('CONS 03- PYM', 'Consulta externa'), { lugar: 'CONSULTA EXTERNA PYM', numero: '3' })
})

test('un nombre que no sigue el patron es el lugar, sin numero', () => {
  assert.deepEqual(partes('FISIOTERAPIA', 'Consulta externa'), { lugar: 'FISIOTERAPIA', numero: null })
})

test('en la cuadricula, que ya agrupa por servicio, "CONSULTORIO N"', () => {
  assert.equal(enCuadricula('CONS 01- CONSULTA EXTERNA', 'Consulta externa'), 'CONSULTORIO 1')
  assert.equal(enCuadricula('CONS 03- PYM', 'Consulta externa'), 'CONSULTORIO 3 · PYM')
  assert.equal(enCuadricula('FISIOTERAPIA', 'Consulta externa'), 'FISIOTERAPIA')
})

test('la cartelera recibe lugar y numero en el mismo campo, y los sabe separar', () => {
  const [casilla] = conNombresDePantalla([{ moduloNombre: 'CONS 02 - ODONTOLOGIA PYM', servicioNombre: 'Odontologia' }], 'cartelera')
  assert.deepEqual(leerLugarYNumero(casilla.moduloNombre), { lugar: 'ODONTOLOGIA PYM', numero: '2' })
  assert.deepEqual(leerLugarYNumero('FISIOTERAPIA'), { lugar: 'FISIOTERAPIA', numero: null })
})

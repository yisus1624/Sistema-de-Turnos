// Renombrar un servicio en la administracion no puede romper la carga diaria.
//
// La carga buscaba el servicio por su nombre EXACTO, mientras que consultorios
// y doctores se emparejan por `claveExterna`. El administrador puede renombrar
// servicios, y cada renombre rompia algo (verificado en PostgreSQL):
//
//   - "Consulta externa" -> "CONSULTA EXTERNA": la carga no lo encontraba,
//     intentaba crearlo y el indice de nombre normalizado lo rechazaba. 500 en
//     CADA subida: el hospital sin agenda.
//   - "Odontologia" -> "Odontología": la carga creaba en silencio otro
//     "Odontologia" con la letra A (la O estaba ocupada). Los turnos del
//     odontologo salian A-001 en el televisor y las citas se iban al duplicado.
import assert from 'node:assert/strict'
import test from 'node:test'

import { base, filaDelReporte, reporteXml, vaciarBase } from './base-falsa-de-carga.mjs'

const { importarReporteDeCitas } = await import('@/lib/citas/importar-reporte')
const { decidirServicio } = await import('@/lib/citas/servicio-del-reporte')
const { SERVICIO_CONSULTA_EXTERNA, SERVICIO_ODONTOLOGIA } = await import('@/lib/citas/reporte-hospital')

const ODONTOLOGIA = {
  procedimiento: 'CONSULTA DE PRIMERA VEZ POR ODONTOLOGIA GENERAL',
  consultorio: 'CONS 01- ODONTOLOGIA',
  profesional: 'DR PRUEBA DOS',
}

const REPORTE = reporteXml([
  filaDelReporte({ documento: '1001', hora: '07:10' }),
  filaDelReporte({ documento: '1002', hora: '07:20', ...ODONTOLOGIA }),
])

const cargar = () => importarReporteDeCitas({ archivo: 'agenda.xml', datos: REPORTE })
const servicioLlamado = (nombre) => base.servicio.find((s) => s.nombre === nombre)
const servicioDeLaCita = (documento) => base.cita.find((c) => c.documentoPaciente === documento).servicioId

/** Lo que hace el administrador en la pantalla de servicios. */
function renombrar(nombre, nuevo) {
  servicioLlamado(nombre).nombre = nuevo
}

/** Un servicio que ya existia antes de que los servicios tuvieran clave. */
function servicioDeAntes(datos) {
  base.servicio.push({ modoFila: 'POR_PROFESIONAL', activo: true, claveExterna: null, ...datos })
}

// ---------------------------------------------------------------------------
// La carga entera, con los dos casos que dejaban al hospital sin agenda
// ---------------------------------------------------------------------------

test('cambiarle solo las mayusculas al servicio no tumba la carga siguiente', async () => {
  vaciarBase()
  await cargar()
  const consulta = servicioLlamado('Consulta externa')

  renombrar('Consulta externa', 'CONSULTA EXTERNA')
  const resumen = await cargar()

  assert.deepEqual(resumen.serviciosNuevos, [])
  assert.equal(base.servicio.length, 2, 'no aparece ningun servicio nuevo')
  assert.equal(servicioDeLaCita('1001'), consulta.id)
})

test('ponerle la tilde a Odontologia no crea un duplicado con otra letra', async () => {
  vaciarBase()
  await cargar()
  const odontologia = servicioLlamado('Odontologia')

  renombrar('Odontologia', 'Odontología')
  const resumen = await cargar()

  assert.deepEqual(resumen.serviciosNuevos, [])
  assert.equal(base.servicio.length, 2)
  assert.equal(servicioDeLaCita('1002'), odontologia.id, 'las citas siguen en el servicio de siempre')
  assert.equal(odontologia.prefijo, 'O', 'el televisor sigue diciendo O-001')
})

test('el servicio que crea la carga nace con su clave, y despues el nombre da igual', async () => {
  vaciarBase()
  const primera = await cargar()

  assert.deepEqual([...primera.serviciosNuevos].sort(), ['Consulta externa', 'Odontologia'])
  assert.equal(servicioLlamado('Consulta externa').claveExterna, SERVICIO_CONSULTA_EXTERNA.clave)
  assert.equal(servicioLlamado('Odontologia').claveExterna, SERVICIO_ODONTOLOGIA.clave)

  renombrar('Consulta externa', 'Medicina general y especialistas')
  renombrar('Odontologia', 'Salud oral')
  const segunda = await cargar()

  assert.deepEqual(segunda.serviciosNuevos, [])
  assert.equal(base.servicio.length, 2)
})

test('un servicio de antes, sin clave, se reconoce por su nombre y se queda con la clave', async () => {
  vaciarBase()
  // Asi estan hoy en produccion: creados por la carga cuando se emparejaba por
  // nombre, y quiza ya retocados por el administrador.
  servicioDeAntes({ id: 'srv-consulta', nombre: 'Consulta  Externa ', prefijo: 'C' })
  servicioDeAntes({ id: 'srv-odonto', nombre: 'ODONTOLOGÍA', prefijo: 'O' })

  const resumen = await cargar()

  assert.deepEqual(resumen.serviciosNuevos, [])
  assert.equal(servicioDeLaCita('1001'), 'srv-consulta')
  assert.equal(servicioDeLaCita('1002'), 'srv-odonto')
  // Reconocido una vez, ya no depende del nombre.
  assert.equal(base.servicio.find((s) => s.id === 'srv-odonto').claveExterna, 'ODONTOLOGIA')
  renombrar('ODONTOLOGÍA', 'Salud oral')
  assert.deepEqual((await cargar()).serviciosNuevos, [])
})

test('si el nombre lo tiene otro servicio del reporte, se crea con un nombre libre en vez de fallar', async () => {
  vaciarBase()
  // El administrador le puso "Odontologia" al servicio de consulta externa.
  servicioDeAntes({ id: 'srv-consulta', nombre: 'Odontologia', prefijo: 'C', claveExterna: 'CONSULTA EXTERNA' })

  const resumen = await cargar()

  assert.deepEqual(resumen.serviciosNuevos, ['Odontologia (importado)'])
  assert.equal(servicioDeLaCita('1001'), 'srv-consulta')
  assert.notEqual(servicioDeLaCita('1002'), 'srv-consulta', 'odontologia no se mezcla con consulta externa')
})

// ---------------------------------------------------------------------------
// La decision, caso por caso
// ---------------------------------------------------------------------------

const catalogo = (...servicios) =>
  servicios.map((s, i) => ({ id: `s${i + 1}`, prefijo: 'X', activo: true, claveExterna: null, ...s }))

test('manda la clave: el que la tiene se usa se llame como se llame', () => {
  const decision = decidirServicio(
    SERVICIO_ODONTOLOGIA,
    catalogo({ nombre: 'Odontologia' }, { nombre: 'Salud oral', claveExterna: 'ODONTOLOGIA' }),
  )
  assert.deepEqual(decision, { accion: 'usar', id: 's2' })
})

test('sin clave, se adopta el que se llama igual sin mirar mayusculas, tildes ni espacios', () => {
  for (const nombre of ['odontologia', 'ODONTOLOGÍA', '  Odontología  ', 'Odontologia']) {
    assert.deepEqual(decidirServicio(SERVICIO_ODONTOLOGIA, catalogo({ nombre })), { accion: 'adoptar', id: 's1' }, nombre)
  }
})

test('no se adopta un servicio que ya es de otra clave, ni uno que se llama distinto', () => {
  assert.deepEqual(
    decidirServicio(SERVICIO_ODONTOLOGIA, catalogo({ nombre: 'Odontologia', claveExterna: 'CONSULTA EXTERNA' })),
    { accion: 'crear' },
  )
  assert.deepEqual(decidirServicio(SERVICIO_ODONTOLOGIA, catalogo({ nombre: 'Odontologia pediatrica' })), {
    accion: 'crear',
  })
})

test('con dos que se llaman igual (restos del duplicado), gana el activo y luego el de la letra del reporte', () => {
  // El duplicado nacio con otra letra porque la O ya estaba ocupada: el de la O
  // es el de siempre, el que tiene a los doctores y el historico.
  const duplicado = { nombre: 'Odontologia', prefijo: 'A' }
  const original = { nombre: 'Odontología', prefijo: 'O' }
  assert.deepEqual(decidirServicio(SERVICIO_ODONTOLOGIA, catalogo(duplicado, original)), { accion: 'adoptar', id: 's2' })

  // Si el administrador ya apago uno de los dos, se respeta.
  const apagado = { ...original, activo: false }
  assert.deepEqual(decidirServicio(SERVICIO_ODONTOLOGIA, catalogo(duplicado, apagado)), { accion: 'adoptar', id: 's1' })
})

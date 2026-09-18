// Lo que queda ESCRITO cuando alguien cambia algo.
//
// Estas pruebas son de las piezas puras: comparar el antes con el despues y
// armar el resumen de una carga de agenda. No tocan la base ni Next, y cubren
// el fallo que tenian los dos eventos: decian que claves llegaron, no que
// cambio, asi que no servian para deshacer nada.
import assert from 'node:assert/strict'
import test from 'node:test'

const { camposCambiados } = await import('@/lib/seguridad/cambios')
const { detalleDeImportacion } = await import('@/lib/citas/rastro-importacion')

test('solo quedan los campos que de verdad cambiaron, con el antes y el despues', () => {
  const antes = { jornadaMananaInicio: '07:00', jornadaMananaFin: '12:00', volumen: 1 }
  const despues = { jornadaMananaInicio: '06:00', jornadaMananaFin: '12:00', volumen: 1 }

  assert.deepEqual(camposCambiados(antes, despues), {
    jornadaMananaInicio: { antes: '07:00', despues: '06:00' },
  })
})

test('guardar la misma configuracion no deja ningun campo', () => {
  // La pantalla manda SIEMPRE el objeto entero, cambie una cosa o ninguna. Con
  // la lista de claves recibidas, el registro apuntaba las nueve cada vez.
  const configuracion = { jornadaTardeInicio: '13:00', duracionCitaMinutos: 15, mensajePie: 'ESE Chinu' }

  assert.deepEqual(camposCambiados(configuracion, { ...configuracion }), {})
})

test('lo que el cliente no mando no se compara', () => {
  const antes = { nombre: 'Dr. Perez', jornada: 'MANANA', activo: true }

  assert.deepEqual(camposCambiados(antes, { jornada: 'TARDE' }), {
    jornada: { antes: 'MANANA', despues: 'TARDE' },
  })
})

test('una lista que cambia de contenido cuenta como cambio', () => {
  const cambios = camposCambiados({ secciones: ['/admin/citas'] }, { secciones: ['/admin/citas', '/operador'] })

  assert.deepEqual(cambios.secciones, { antes: ['/admin/citas'], despues: ['/admin/citas', '/operador'] })
})

test('un valor que pasa a nulo queda registrado', () => {
  assert.deepEqual(camposCambiados({ moduloId: 'Consultorio 3' }, { moduloId: null }), {
    moduloId: { antes: 'Consultorio 3', despues: null },
  })
})

// --- La carga de la agenda del hospital ---

const resumenBase = {
  creadas: 10,
  actualizadas: 2,
  omitidas: 1,
  errores: ['fila 4 sin documento'],
  fechas: ['2026-09-14'],
  consultoriosNuevos: ['CONS 07'],
  profesionalesNuevos: ['YENNY CORTES'],
  jornadasAjustadas: [{ nombre: 'Dr. Perez', jornada: 'TARDE', anterior: 'MANANA', diasTrabajados: 8 }],
}

test('el detalle de la carga dice que catalogo se creo solo', () => {
  const detalle = detalleDeImportacion(resumenBase)

  assert.deepEqual(detalle.consultoriosNuevos, ['CONS 07'])
  assert.deepEqual(detalle.profesionalesNuevos, ['YENNY CORTES'])
})

test('una jornada ajustada sola queda con el valor anterior, para poder revertirla', () => {
  const detalle = detalleDeImportacion(resumenBase)

  assert.deepEqual(detalle.jornadasAjustadas, ['Dr. Perez: MANANA -> TARDE'])
})

test('una carga que no creo catalogo no ensucia el detalle', () => {
  const detalle = detalleDeImportacion({
    ...resumenBase,
    consultoriosNuevos: [],
    profesionalesNuevos: [],
    jornadasAjustadas: [],
  })

  assert.equal('consultoriosNuevos' in detalle, false)
  assert.equal('profesionalesNuevos' in detalle, false)
  assert.equal('jornadasAjustadas' in detalle, false)
  assert.equal(detalle.creadas, 10)
  assert.equal(detalle.errores, 1)
})

// --- Como se lee el detalle en la pantalla del registro ---

const { resumirDetalle } = await import('@/lib/seguridad/detalle')

test('un cambio se lee "antes -> despues", no como un objeto', () => {
  const texto = resumirDetalle({ cambios: { jornada: { antes: 'MANANA', despues: 'TARDE' } } })

  assert.equal(texto, 'jornada: MANANA -> TARDE')
})

test('un evento sin nada que contar no pinta una fila vacia', () => {
  assert.equal(resumirDetalle(undefined), '—')
  assert.equal(resumirDetalle({ cambios: {} }), '—')
})

test('el resto del detalle se sigue leyendo junto a los cambios', () => {
  const texto = resumirDetalle({ motivo: 'La tarde no puede empezar antes', cambios: { volumen: { antes: 1, despues: 0 } } })

  assert.equal(texto, 'motivo: La tarde no puede empezar antes · volumen: 1 -> 0')
})

test('un campo que se queda vacio se lee como "sin asignar"', () => {
  assert.equal(resumirDetalle({ cambios: { consultorio: { antes: 'Consultorio 3', despues: null } } }),
    'consultorio: Consultorio 3 -> sin asignar')
})

test('las listas se leen separadas por comas', () => {
  assert.equal(resumirDetalle({ jornadasAjustadas: ['Dr. Perez: MANANA -> TARDE'] }), 'jornadasAjustadas: Dr. Perez: MANANA -> TARDE')
})

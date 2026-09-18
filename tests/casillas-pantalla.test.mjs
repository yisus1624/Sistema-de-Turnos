// Que consultorios se pintan en el televisor de la sala de espera.
//
// Es lo que ve el paciente, y hasta ahora no tenia ni una prueba. El criterio
// se escribio primero dentro de la implementacion contra Postgres y la de
// memoria se quedo mostrando una casilla por modulo activo: dos comportamientos
// opuestos para el mismo contrato. La unica prueba que habia corria contra la de
// memoria, asi que daba por bueno justo lo contrario de lo que hacia el
// hospital de verdad.
//
// Ahora el criterio es una funcion pura y compartida, y cada caso esta aqui.
import assert from 'node:assert/strict'
import test from 'node:test'

const { modulosVisiblesEnPantalla } = await import('@/lib/turnos/casillas')

const CONSULTA_EXTERNA = 'srv-consulta-externa'
const FACTURACION = 'srv-facturacion'

/** El escenario base: dos consultorios y una ventanilla, y nada mas. */
function entrada(cambios = {}) {
  return {
    modulos: [
      { id: 'cons-1', servicioId: CONSULTA_EXTERNA },
      { id: 'cons-2', servicioId: CONSULTA_EXTERNA },
      { id: 'ventanilla', servicioId: FACTURACION },
    ],
    serviciosDeVentanilla: new Set([FACTURACION]),
    conCitasHoy: new Set(),
    conTurnosHoy: new Set(),
    conProfesionalAsignado: new Set(),
    hayAgendaDelDia: false,
    ...cambios,
  }
}

test('el consultorio con citas hoy se ve; el que no tiene ninguna, no', () => {
  const visibles = modulosVisiblesEnPantalla(
    entrada({ conCitasHoy: new Set(['cons-1']), hayAgendaDelDia: true }),
  )

  assert.ok(visibles.has('cons-1'))
  assert.equal(visibles.has('cons-2'), false, 'el consultorio sin agenda hoy no ocupa el televisor')
})

test('el consultorio desde el que ya se llamo un turno se ve, aunque el paciente no tuviera cita', () => {
  // Pasa con el paciente que llega sin agendar: su turno nace en el consultorio
  // y desde ese momento la casilla tiene que estar.
  const visibles = modulosVisiblesEnPantalla(
    entrada({ conTurnosHoy: new Set(['cons-2']), hayAgendaDelDia: true }),
  )

  assert.ok(visibles.has('cons-2'))
})

test('la ventanilla de orden de llegada se ve siempre', () => {
  // No tiene agenda que mirar. Con agenda cargada y sin un solo paciente suyo,
  // sigue viendose.
  const visibles = modulosVisiblesEnPantalla(
    entrada({ conCitasHoy: new Set(['cons-1']), hayAgendaDelDia: true }),
  )

  assert.ok(visibles.has('ventanilla'))
})

test('el modulo sin servicio se trata como ventanilla y tambien se ve', () => {
  // Queda asi cuando se elimina el servicio al que colgaba.
  const visibles = modulosVisiblesEnPantalla(
    entrada({
      modulos: [{ id: 'huerfano', servicioId: null }],
      hayAgendaDelDia: true,
    }),
  )

  assert.ok(visibles.has('huerfano'))
})

test('antes de cargar la agenda del dia, los consultorios con doctor asignado se ven', () => {
  // EL AMANECER. La agenda se sube al abrir el hospital; antes de eso no hay ni
  // una cita ni un turno. Sin este respaldo el televisor amanecia mostrando
  // solo las ventanillas, y si el hospital no tuviera ninguna se quedaba con el
  // cartel de "aun no hay consultorios activos", que se lee como que el sistema
  // se cayo.
  const visibles = modulosVisiblesEnPantalla(
    entrada({ conProfesionalAsignado: new Set(['cons-1', 'cons-2']), hayAgendaDelDia: false }),
  )

  assert.ok(visibles.has('cons-1'))
  assert.ok(visibles.has('cons-2'))
})

test('el consultorio sin doctor asignado no se ve ni antes de cargar la agenda', () => {
  // Es el que sobra del catalogo: existe porque alguna vez aparecio en un
  // reporte, pero no hay nadie que pueda sentarse ahi.
  const visibles = modulosVisiblesEnPantalla(
    entrada({ conProfesionalAsignado: new Set(['cons-1']), hayAgendaDelDia: false }),
  )

  assert.equal(visibles.has('cons-2'), false)
})

test('un dia con la agenda cargada y todas las citas canceladas NO reenciende el respaldo', () => {
  // EL BORDE. `hayAgendaDelDia` significa "la agenda del dia ya se subio", no
  // "quedan citas vivas". Contandolo de la segunda forma, cancelar las citas
  // del dia —o reiniciar los datos— hacia que el dia pareciera otra vez sin
  // cargar, y a media mañana volvian al televisor las casillas de consultorios
  // donde no hay nadie, que es justo lo que este filtro vino a quitar.
  const visibles = modulosVisiblesEnPantalla(
    entrada({
      conCitasHoy: new Set(), // todas canceladas: ninguna cuenta como actividad
      conProfesionalAsignado: new Set(['cons-1', 'cons-2']),
      hayAgendaDelDia: true, // pero la agenda SI se subio hoy
    }),
  )

  assert.equal(visibles.has('cons-1'), false)
  assert.equal(visibles.has('cons-2'), false)
  assert.ok(visibles.has('ventanilla'), 'las ventanillas siguen ahi, como siempre')
})

test('en cuanto entra la agenda del dia, mandan las citas y el respaldo se apaga', () => {
  // Con agenda cargada, tener un doctor asignado ya no basta: lo que decide es
  // si ese doctor tiene pacientes hoy.
  const visibles = modulosVisiblesEnPantalla(
    entrada({
      conCitasHoy: new Set(['cons-1']),
      conProfesionalAsignado: new Set(['cons-1', 'cons-2']),
      hayAgendaDelDia: true,
    }),
  )

  assert.ok(visibles.has('cons-1'))
  assert.equal(visibles.has('cons-2'), false)
})

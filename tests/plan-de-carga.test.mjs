// Que hace la carga diaria con cada fila del reporte del hospital.
//
// ERA LA MAYOR ZONA CIEGA DEL SISTEMA. De esta decision dependen las tres
// promesas que el propio importador declara en su cabecera —volver a subir el
// mismo archivo no duplica nada, no se toca a un paciente que ya llego, y una
// fila repetida no es una cita nueva— y no tenia ni una prueba, porque estaba
// dentro de un bucle que escribia con Prisma y no habia forma de ejercitarla sin
// una base de datos delante.
//
// Son las reglas de mas riesgo de la carga: el reporte se sube cada mañana, a
// veces dos veces, y a media mañana llega el archivo corregido mientras hay
// pacientes ya presentes en la sala.
import assert from 'node:assert/strict'
import test from 'node:test'

const { decidirFila, claveDeCita } = await import('@/lib/citas/plan-de-carga')

/** La fila tal como viene del archivo. */
function fila(cambios = {}) {
  return {
    nombrePaciente: 'JUAN CARLOS PEREZ',
    tipoDocumento: 'CC',
    procedimiento: 'CONSULTA MEDICINA GENERAL',
    cups: '890201',
    servicioId: 'srv-consulta-externa',
    ...cambios,
  }
}

/** La cita que ya esta guardada. Por defecto, identica a la fila. */
function guardada(cambios = {}) {
  return { id: 'cita-1', estado: 'PROGRAMADA', ...fila(), ...cambios }
}

// ---------------------------------------------------------------------------
// Volver a subir el mismo archivo tiene que ser inofensivo
// ---------------------------------------------------------------------------

test('una cita que ya esta guardada igual no se toca', () => {
  // Es EL caso normal: el operador que no esta seguro de si ya subio el archivo
  // lo sube otra vez. Si esto crease o actualizase, cada mañana el resumen
  // diria que se corrigieron trescientas citas sin haber cambiado ninguna.
  const decision = decidirFila({ fila: fila(), existente: guardada(), yaVista: false })

  assert.equal(decision.accion, 'omitir')
  assert.equal(decision.motivo, 'sin_cambios')
})

test('una cita que todavia no existe se crea', () => {
  const decision = decidirFila({ fila: fila(), existente: undefined, yaVista: false })

  assert.equal(decision.accion, 'crear')
})

test('la misma fila repetida dentro del archivo no se cuenta dos veces', () => {
  // El reporte del hospital trae filas repetidas. La segunda no es una cita
  // nueva ni un error: es la misma.
  const decision = decidirFila({ fila: fila(), existente: undefined, yaVista: true })

  assert.equal(decision.accion, 'omitir')
  assert.equal(decision.motivo, 'repetida_en_el_archivo')
})

// ---------------------------------------------------------------------------
// No se toca a un paciente que ya llego
// ---------------------------------------------------------------------------

test('la cita de un paciente que ya registro su llegada no se reescribe', () => {
  // Reescribirla podria mandarlo a otra fila o dejarlo sin el turno que ya
  // tiene en la mano, con el paciente sentado en la sala.
  const decision = decidirFila({
    fila: fila({ nombrePaciente: 'JUAN C. PEREZ' }),
    existente: guardada({ estado: 'PRESENTADO' }),
    yaVista: false,
  })

  assert.equal(decision.accion, 'omitir')
  assert.equal(decision.motivo, 'paciente_ya_llego')
})

test('tampoco se reescribe la de un paciente ya atendido', () => {
  const decision = decidirFila({
    fila: fila({ procedimiento: 'OTRO PROCEDIMIENTO' }),
    existente: guardada({ estado: 'ATENDIDA' }),
    yaVista: false,
  })

  assert.equal(decision.accion, 'omitir')
})

test('una cita cancelada aqui no la resucita la carga', () => {
  // Cancelar la tomo una persona mirando al paciente; un archivo no puede
  // deshacerlo por su cuenta.
  const decision = decidirFila({
    fila: fila(),
    existente: guardada({ estado: 'CANCELADA' }),
    yaVista: false,
  })

  assert.equal(decision.accion, 'omitir')
  assert.equal(decision.motivo, 'paciente_ya_llego')
})

// ---------------------------------------------------------------------------
// El archivo corregido de media mañana
// ---------------------------------------------------------------------------

test('solo se escriben los campos que de verdad cambiaron', () => {
  const decision = decidirFila({
    fila: fila({ nombrePaciente: 'JUAN CARLOS PEREZ GOMEZ' }),
    existente: guardada(),
    yaVista: false,
  })

  assert.equal(decision.accion, 'actualizar')
  assert.equal(decision.id, 'cita-1')
  assert.deepEqual(decision.datos, { nombrePaciente: 'JUAN CARLOS PEREZ GOMEZ' })
})

test('un cambio de servicio se aplica, porque decide en que fila entra el paciente', () => {
  const decision = decidirFila({
    fila: fila({ servicioId: 'srv-odontologia' }),
    existente: guardada(),
    yaVista: false,
  })

  assert.equal(decision.accion, 'actualizar')
  assert.deepEqual(decision.datos, { servicioId: 'srv-odontologia' })
})

test('un campo que pasa a vacio tambien se corrige', () => {
  // `undefined` y `null` no son lo mismo al comparar: si esto no se detectara,
  // un procedimiento retirado en el reporte se quedaria puesto para siempre.
  const decision = decidirFila({
    fila: fila({ cups: null }),
    existente: guardada(),
    yaVista: false,
  })

  assert.equal(decision.accion, 'actualizar')
  assert.deepEqual(decision.datos, { cups: null })
})

test('varios campos cambiados se escriben juntos, y solo ellos', () => {
  const decision = decidirFila({
    fila: fila({ nombrePaciente: 'OTRO NOMBRE', tipoDocumento: 'TI' }),
    existente: guardada(),
    yaVista: false,
  })

  assert.equal(decision.accion, 'actualizar')
  assert.deepEqual(decision.datos, { nombrePaciente: 'OTRO NOMBRE', tipoDocumento: 'TI' })
})

test('lo repetido en el archivo manda sobre todo lo demas', () => {
  // Aunque la cita guardada tenga cambios pendientes: la primera aparicion ya
  // los aplico, y la segunda tiene que ser inofensiva.
  const decision = decidirFila({
    fila: fila({ nombrePaciente: 'OTRO NOMBRE' }),
    existente: guardada(),
    yaVista: true,
  })

  assert.equal(decision.accion, 'omitir')
  assert.equal(decision.motivo, 'repetida_en_el_archivo')
})

// ---------------------------------------------------------------------------
// La clave con la que se reconoce una cita entre los dos sistemas
// ---------------------------------------------------------------------------

test('la cita se identifica por dia, documento, doctor y hora', () => {
  const clave = claveDeCita('2026-09-17', '1067890123', 'pro-perez', '2026-09-17T13:00:00.000Z')

  assert.equal(clave, '2026-09-17|1067890123|pro-perez|2026-09-17T13:00:00.000Z')
})

test('el mismo paciente a otra hora es otra cita', () => {
  // El hospital cita al mismo paciente dos veces el mismo dia con doctores
  // distintos, y tambien a distinta hora con el mismo doctor.
  const aLasNueve = claveDeCita('2026-09-17', '1067890123', 'pro-perez', '2026-09-17T14:00:00.000Z')
  const aLasDiez = claveDeCita('2026-09-17', '1067890123', 'pro-perez', '2026-09-17T15:00:00.000Z')

  assert.notEqual(aLasNueve, aLasDiez)
})

test('el mismo paciente a la misma hora con otro doctor es otra cita', () => {
  const conPerez = claveDeCita('2026-09-17', '1067890123', 'pro-perez', '2026-09-17T14:00:00.000Z')
  const conGomez = claveDeCita('2026-09-17', '1067890123', 'pro-gomez', '2026-09-17T14:00:00.000Z')

  assert.notEqual(conPerez, conGomez)
})

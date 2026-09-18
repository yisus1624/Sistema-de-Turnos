// Modulos de administracion: servicios, modulos, configuracion y estadisticas
// (requerimiento secciones 6.1, 15 y 19).
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

const repo = new InMemoryTurnoRepository()

test('crear un servicio normaliza el prefijo a mayusculas', async () => {
  const servicio = await repo.crearServicio({
    nombre: 'Autorizaciones',
    prefijo: 'au',
    modoFila: 'COMPARTIDA',
    activo: true,
  })

  assert.equal(servicio.prefijo, 'AU')
  assert.match(servicio.id, /^srv-/)
})

test('no se puede repetir el prefijo de otro servicio', async () => {
  await assert.rejects(
    () => repo.crearServicio({ nombre: 'Otro', prefijo: 'C', modoFila: 'COMPARTIDA', activo: true }),
    /ya lo usa otro servicio/i,
  )
})

test('el turno usa el prefijo nuevo despues de editar el servicio', async () => {
  const servicio = await repo.crearServicio({
    nombre: 'Entrega de resultados',
    prefijo: 'X',
    modoFila: 'COMPARTIDA',
    activo: true,
  })

  const antes = await repo.generarTurnoDeVentanilla(servicio.id)
  assert.match(antes.codigo, /^X-/)

  await repo.actualizarServicio(servicio.id, { prefijo: 'R' })
  const despues = await repo.generarTurnoDeVentanilla(servicio.id)
  assert.match(despues.codigo, /^R-/)
})

test('desactivar un servicio lo saca del listado', async () => {
  const servicio = await repo.crearServicio({
    nombre: 'Temporal',
    prefijo: 'T',
    modoFila: 'COMPARTIDA',
    activo: true,
  })

  await repo.actualizarServicio(servicio.id, { activo: false })
  const activos = await repo.listarServicios()
  assert.equal(activos.some((s) => s.id === servicio.id), false)
})

// ...pero la administracion tiene que poder verlo, o desactivar seria borrar.
//
// El listado de activos era el UNICO que consultaba la pantalla de servicios:
// al apagar el interruptor, la fila desaparecia del catalogo y ya no habia
// forma de volver a activarla desde ninguna parte. Lo mismo con los modulos.
test('un servicio desactivado se sigue viendo en el catalogo de administracion', async () => {
  const servicio = await repo.crearServicio({
    nombre: 'Se apaga y se vuelve a prender',
    prefijo: 'Z',
    modoFila: 'COMPARTIDA',
    activo: true,
  })
  await repo.actualizarServicio(servicio.id, { activo: false })

  const todos = await repo.listarServicios(true)
  assert.equal(todos.some((s) => s.id === servicio.id), true, 'sin esto no se puede reactivar')

  await repo.actualizarServicio(servicio.id, { activo: true })
  const activos = await repo.listarServicios()
  assert.equal(activos.some((s) => s.id === servicio.id), true)
})

test('un modulo desactivado se sigue viendo en el catalogo de administracion', async () => {
  const modulo = await repo.crearModulo({
    nombre: 'Consultorio que se apaga',
    servicioId: 'srv-consulta-externa',
    activo: true,
  })
  await repo.actualizarModulo(modulo.id, { activo: false })

  assert.equal(
    (await repo.listarModulos()).some((m) => m.id === modulo.id),
    false,
    'no sale en la pantalla de la sala de espera',
  )
  assert.equal(
    (await repo.listarModulos(undefined, true)).some((m) => m.id === modulo.id),
    true,
    'pero si en administracion, que es donde se vuelve a activar',
  )
})

test('un modulo sin servicio es una ventanilla general', async () => {
  const modulo = await repo.crearModulo({ nombre: 'Ventanilla 9', servicioId: null, activo: true })
  assert.equal(modulo.servicioId, null)

  const deConsultaExterna = await repo.listarModulos('srv-consulta-externa')
  assert.equal(
    deConsultaExterna.some((m) => m.id === modulo.id),
    true,
    'las ventanillas generales sirven para cualquier servicio',
  )
})

test('crear un modulo con un servicio inexistente falla', async () => {
  await assert.rejects(
    () => repo.crearModulo({ nombre: 'Consultorio fantasma', servicioId: 'srv-no-existe', activo: true }),
    /servicio/i,
  )
})

test('la configuracion se guarda parcialmente', async () => {
  const inicial = await repo.configuracion()
  assert.equal(inicial.audioActivo, true)

  const guardada = await repo.guardarConfiguracion({ volumen: 0.5, mensajePie: 'Hola' })
  assert.equal(guardada.volumen, 0.5)
  assert.equal(guardada.mensajePie, 'Hola')
  // Lo que no se envia no se pierde.
  assert.equal(guardada.audioActivo, inicial.audioActivo)
  assert.equal(guardada.duracionCitaMinutos, inicial.duracionCitaMinutos)
})

// El catalogo de ejemplo ya no trae filas de ventanilla (el hospital atiende
// todo por cita), pero el sistema las sigue soportando: estas pruebas crean la
// suya, que ademas las deja aisladas de los turnos de las demas.
async function ventanillaPropia(nombre, prefijo) {
  const servicio = await repo.crearServicio({ nombre, prefijo, modoFila: 'COMPARTIDA', activo: true })
  const modulo = await repo.crearModulo({ nombre, servicioId: servicio.id, activo: true })
  return { servicio, modulo }
}

test('las estadisticas cuentan generados, atendidos, ausentes y tiempos', async () => {
  const hoy = hoyColombia()
  const { servicio, modulo } = await ventanillaPropia('Estadisticas', 'ES')

  const atendido = await repo.generarTurnoDeVentanilla(servicio.id)
  await repo.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: 'func-1',
  })
  await repo.marcarAtendido(atendido.id)

  const ausente = await repo.generarTurnoDeVentanilla(servicio.id)
  await repo.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: 'func-1',
  })
  await repo.marcarAusente(ausente.id)

  const estadisticas = await repo.estadisticas(hoy)
  const propias = estadisticas.porServicio.find((s) => s.servicioId === servicio.id)

  assert.equal(propias.generados, 2)
  assert.equal(propias.atendidos, 1)
  assert.equal(propias.ausentes, 1)
  assert.equal(typeof propias.minutosEsperaPromedio, 'number')
  assert.ok(estadisticas.porFuncionario.some((f) => f.funcionarioId === 'func-1'))
})

test('un dia sin turnos devuelve el resumen en cero', async () => {
  const estadisticas = await repo.estadisticas('2020-01-01')
  assert.equal(estadisticas.total.generados, 0)
  assert.equal(estadisticas.total.minutosEsperaPromedio, null)
  assert.deepEqual(estadisticas.porFuncionario, [])
})

// Dia de hoy en hora Colombia (no UTC), igual que lo calcula la UI.
function hoyColombia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

test('el historico filtra por codigo parcial y ordena del mas reciente', async () => {
  const hoy = hoyColombia()
  const todos = await repo.historico({ fecha: hoy })

  assert.ok(todos.length > 0)
  for (let i = 1; i < todos.length; i++) {
    assert.ok(
      new Date(todos[i - 1].fechaGeneracion) >= new Date(todos[i].fechaGeneracion),
      'el historico debe venir del mas reciente al mas antiguo',
    )
  }

  // El filtro de codigo busca por coincidencia parcial, asi que la prueba se
  // trae su propio servicio: con un prefijo cualquiera acabaria colando los
  // turnos de otro servicio que lo contenga (un 'S-' tambien esta dentro de
  // 'ES-001').
  const { servicio } = await ventanillaPropia('Historico', 'HI')
  await repo.generarTurnoDeVentanilla(servicio.id)

  const filtrados = await repo.historico({ codigo: 'HI-' })
  assert.ok(filtrados.length > 0, 'el filtro parcial debe encontrar el turno')
  assert.ok(filtrados.every((t) => t.codigo.includes('HI-')))
})

test('el historico y las estadisticas cuentan el dia en hora Colombia, no en UTC', async () => {
  const { servicio } = await ventanillaPropia('Zona horaria', 'ZH')
  const turno = await repo.generarTurnoDeVentanilla(servicio.id)
  // 02:30 UTC = 21:30 del dia ANTERIOR en Colombia (UTC-5).
  turno.fechaGeneracion = '2026-06-15T02:30:00.000Z'

  // Debe contar en el dia colombiano (14), no en el dia UTC (15).
  const enDiaColombia = await repo.historico({ fecha: '2026-06-14' })
  assert.ok(enDiaColombia.some((t) => t.id === turno.id), 'el turno debe verse en su dia local (14)')

  const enDiaUtc = await repo.historico({ fecha: '2026-06-15' })
  assert.equal(enDiaUtc.some((t) => t.id === turno.id), false, 'no debe verse en el dia UTC (15)')

  const stats = await repo.estadisticas('2026-06-14')
  const propias = stats.porServicio.find((s) => s.servicioId === servicio.id)
  assert.ok(propias.generados >= 1, 'las estadisticas del dia local deben incluir el turno')
})

// El nombre del consultorio es lo unico que se le da al paciente para saber por
// que puerta entrar ("turno C-014, consultorio 3"), y es lo que rotula cada
// casilla del televisor. Con dos "Consultorio 3" en pantalla, ese dato deja de
// identificar una puerta. Nada lo impedia.
test('no puede haber dos consultorios con el mismo nombre', async () => {
  await repo.crearModulo({ nombre: 'Consultorio 41', servicioId: null, activo: true })

  await assert.rejects(
    () => repo.crearModulo({ nombre: 'Consultorio 41', servicioId: null, activo: true }),
    /Ya existe/i,
  )

  // Ni escribiendolo distinto: quien lo lee ve el mismo numero de puerta.
  await assert.rejects(
    () => repo.crearModulo({ nombre: '  consultorio 41 ', servicioId: null, activo: true }),
    /Ya existe/i,
  )
})

test('renombrar un modulo tampoco permite chocar con otro', async () => {
  const uno = await repo.crearModulo({ nombre: 'Consultorio 42', servicioId: null, activo: true })
  await repo.crearModulo({ nombre: 'Consultorio 43', servicioId: null, activo: true })

  await assert.rejects(() => repo.actualizarModulo(uno.id, { nombre: 'Consultorio 43' }), /Ya existe/i)

  // Pero guardarlo con su propio nombre no puede fallar.
  const igual = await repo.actualizarModulo(uno.id, { nombre: 'Consultorio 42' })
  assert.equal(igual.nombre, 'Consultorio 42')
})

test('no se cambia a ventanilla un servicio que tiene doctores o citas', async () => {
  const servicio = await repo.crearServicio({
    nombre: 'Especialidad con agenda',
    prefijo: 'ZA',
    modoFila: 'POR_PROFESIONAL',
    activo: true,
  })
  await repo.crearProfesional({
    nombre: 'Dra. Prueba Modo',
    servicioId: servicio.id,
    jornada: 'COMPLETA',
    moduloId: null,
  })

  // Pasarlo a ventanilla dejaria a esa doctora colgando de un servicio que no
  // lleva profesionales, y a sus pacientes sin poder reprogramar.
  await assert.rejects(
    () => repo.actualizarServicio(servicio.id, { modoFila: 'COMPARTIDA' }),
    /profesional/i,
  )

  // El resto del servicio si se puede seguir editando.
  const renombrado = await repo.actualizarServicio(servicio.id, { nombre: 'Especialidad renombrada' })
  assert.equal(renombrado.nombre, 'Especialidad renombrada')
  assert.equal(renombrado.modoFila, 'POR_PROFESIONAL')
})

test('no se pasa a atencion por cita un servicio con pacientes en la fila', async () => {
  const servicio = await repo.crearServicio({
    nombre: 'Ventanilla con cola',
    prefijo: 'ZB',
    modoFila: 'COMPARTIDA',
    activo: true,
  })
  await repo.generarTurnoDeVentanilla(servicio.id)

  // Ese turno no tiene doctor. Si el servicio pasa a atenderse por cita, se le
  // llamaria desde la pantalla del doctor —que busca por doctor— y ese paciente
  // se quedaria en la cola para siempre, sin que nadie lo vea.
  await assert.rejects(
    () => repo.actualizarServicio(servicio.id, { modoFila: 'POR_PROFESIONAL' }),
    /fila sin doctor/i,
  )
})

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
    () => repo.crearServicio({ nombre: 'Otro', prefijo: 'A', modoFila: 'COMPARTIDA', activo: true }),
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

  const guardada = await repo.guardarConfiguracion({ repeticionesAudio: 3, mensajePie: 'Hola' })
  assert.equal(guardada.repeticionesAudio, 3)
  assert.equal(guardada.mensajePie, 'Hola')
  // Lo que no se envia no se pierde.
  assert.equal(guardada.audioActivo, inicial.audioActivo)
  assert.equal(guardada.volumen, inicial.volumen)
})

test('las estadisticas cuentan generados, atendidos, ausentes y tiempos', async () => {
  const hoy = hoyColombia()

  const atendido = await repo.generarTurnoDeVentanilla('srv-siau')
  await repo.llamarSiguiente({
    servicioId: 'srv-siau',
    moduloId: 'mod-ventanilla-1',
    funcionarioId: 'func-1',
  })
  await repo.marcarAtendido(atendido.id)

  const ausente = await repo.generarTurnoDeVentanilla('srv-siau')
  await repo.llamarSiguiente({
    servicioId: 'srv-siau',
    moduloId: 'mod-ventanilla-1',
    funcionarioId: 'func-1',
  })
  await repo.marcarAusente(ausente.id)

  const estadisticas = await repo.estadisticas(hoy)
  const siau = estadisticas.porServicio.find((s) => s.servicioId === 'srv-siau')

  assert.ok(siau.generados >= 2)
  assert.ok(siau.atendidos >= 1)
  assert.ok(siau.ausentes >= 1)
  assert.equal(typeof siau.minutosEsperaPromedio, 'number')
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

  const soloSiau = await repo.historico({ codigo: 'S-' })
  assert.ok(soloSiau.every((t) => t.codigo.startsWith('S-')))
})

test('el historico y las estadisticas cuentan el dia en hora Colombia, no en UTC', async () => {
  const turno = await repo.generarTurnoDeVentanilla('srv-siau')
  // 02:30 UTC = 21:30 del dia ANTERIOR en Colombia (UTC-5).
  turno.fechaGeneracion = '2026-06-15T02:30:00.000Z'

  // Debe contar en el dia colombiano (14), no en el dia UTC (15).
  const enDiaColombia = await repo.historico({ fecha: '2026-06-14' })
  assert.ok(enDiaColombia.some((t) => t.id === turno.id), 'el turno debe verse en su dia local (14)')

  const enDiaUtc = await repo.historico({ fecha: '2026-06-15' })
  assert.equal(enDiaUtc.some((t) => t.id === turno.id), false, 'no debe verse en el dia UTC (15)')

  const stats = await repo.estadisticas('2026-06-14')
  const siau = stats.porServicio.find((s) => s.servicioId === 'srv-siau')
  assert.ok(siau.generados >= 1, 'las estadisticas del dia local deben incluir el turno')
})

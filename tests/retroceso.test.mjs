// Retroceder al turno anterior: el doctor se equivoca y lo deshace sin perder a
// nadie, sin cerrar a nadie de mas y con el televisor al dia.
//
// Se prueba la regla pura y el CONTRATO con la implementacion en memoria: la
// de PostgreSQL aplica la misma regla dentro de una transaccion.
import assert from 'node:assert/strict'
import test from 'node:test'

const { planDeRetroceso, exigirPlanVisto } = await import('@/lib/turnos/reglas-retroceso')
const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')
const { realtimeHub } = await import('@/lib/realtime/hub')
const { interpretarMensaje, afectaALaFila } = await import('@/lib/realtime/canal')

// --- La regla ---------------------------------------------------------------

const t = (id, extra = {}) => ({ id, codigo: id, estado: 'LLAMADO', vecesLlamado: 1, ...extra })

test('si el llamado de C cerro solo a B, retroceder devuelve a C y restaura a B', () => {
  const c = t('C', { horaPrimerLlamado: '2026-09-23T15:00:00.000Z' })
  const b = t('B', { estado: 'ATENDIDO', cierreAutomatico: true, cerradoEn: '2026-09-23T15:00:00.020Z' })
  assert.deepEqual(planDeRetroceso(c, b), { devolver: c, restaurar: b })
})

test('si B lo cerro el doctor a mano, retroceder solo devuelve a C', () => {
  const c = t('C', { horaPrimerLlamado: '2026-09-23T15:10:00.000Z' })
  const b = t('B', { estado: 'ATENDIDO', cierreAutomatico: false, cerradoEn: '2026-09-23T15:05:00.000Z' })
  assert.deepEqual(planDeRetroceso(c, b), { devolver: c, restaurar: null })
})

test('un cierre automatico de antes (de otro llamado) no se restaura con el de C', () => {
  const c = t('C', { horaPrimerLlamado: '2026-09-23T15:30:00.000Z' })
  const b = t('B', { estado: 'ATENDIDO', cierreAutomatico: true, cerradoEn: '2026-09-23T15:00:00.000Z' })
  assert.equal(planDeRetroceso(c, b).restaurar, null)
})

test('sin nadie abierto, retroceder vuelve a abrir al ultimo cerrado (atendido o ausente)', () => {
  const b = t('B', { estado: 'AUSENTE', cerradoEn: '2026-09-23T15:00:00.000Z' })
  assert.deepEqual(planDeRetroceso(null, b), { devolver: null, restaurar: b })
  assert.equal(planDeRetroceso(null, null), null)
})

test('solo se retrocede lo que el doctor vio: lo demas es 409 o 400', () => {
  const plan = { devolver: t('C'), restaurar: t('B') }
  assert.equal(exigirPlanVisto(plan, { turnoAbiertoId: 'C', restaurarId: 'B' }), plan)
  assert.throws(() => exigirPlanVisto(plan, { turnoAbiertoId: 'C', restaurarId: null }), (e) => e.status === 409)
  assert.throws(() => exigirPlanVisto(plan, { turnoAbiertoId: 'B', restaurarId: 'A' }), (e) => e.status === 409)
  assert.throws(() => exigirPlanVisto(null, { turnoAbiertoId: null, restaurarId: null }), (e) => e.status === 400)
})

// --- El contrato --------------------------------------------------------------

const repo = new InMemoryTurnoRepository()
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())

let creados = 0
async function consultorio() {
  creados += 1
  const modulo = await repo.crearModulo({ nombre: `Consultorio retroceso ${creados}`, servicioId: 'srv-consulta-externa', activo: true })
  const doctor = await repo.crearProfesional({
    nombre: `Dr. Retroceso ${creados}`,
    servicioId: 'srv-consulta-externa',
    jornada: 'COMPLETA',
    moduloId: modulo.id,
  })
  return { doctor, modulo }
}

let documentos = 910000
async function enEspera(profesionalId, hora) {
  documentos += 1
  const cita = await repo.crearCita({
    documentoPaciente: String(documentos),
    nombrePaciente: `Paciente ${documentos}`,
    profesionalId,
    horaCita: new Date(`${HOY}T${hora}:00-05:00`).toISOString(),
  })
  return (await repo.registrarLlegada(cita.id)).turno
}

const llamar = ({ doctor, modulo }, abierto) =>
  repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: doctor.id, turnoAbiertoEsperado: abierto })

/** Retrocede con lo que la pantalla ve en este momento, como hace el doctor. */
async function retroceder({ doctor }) {
  const plan = await repo.planDeRetroceso(doctor.id)
  return repo.retrocederTurno(doctor.id, {
    turnoAbiertoId: plan?.devolver?.id ?? null,
    restaurarId: plan?.restaurar?.id ?? null,
  })
}

async function escuchar(trabajo) {
  const eventos = []
  const soltar = realtimeHub.subscribe((e) => eventos.push(e))
  try {
    await trabajo()
  } finally {
    soltar()
  }
  return eventos
}

test('"Siguiente" por error: C vuelve primero a la fila y B vuelve a atencion y al televisor', async () => {
  const sala = await consultorio()
  const b = await enEspera(sala.doctor.id, '08:00')
  const c = await enEspera(sala.doctor.id, '08:15')
  const d = await enEspera(sala.doctor.id, '08:30')

  await llamar(sala, null) // B
  await llamar(sala, b.id) // C, y B se cierra solo

  const eventos = await escuchar(() => retroceder(sala))

  assert.equal((await repo.turnoAbierto({ profesionalId: sala.doctor.id }, HOY)).id, b.id)
  const pendientes = await repo.listarPendientes({ profesionalId: sala.doctor.id })
  assert.deepEqual(pendientes.map((x) => x.id), [c.id, d.id], 'C vuelve a su mismo puesto, antes que D')

  const devuelto = pendientes[0]
  assert.equal(devuelto.moduloId, null)
  assert.equal(devuelto.horaPrimerLlamado, null, 'su espera sigue contando hasta el llamado de verdad')
  assert.equal(devuelto.vecesLlamado, 0)

  const [restaurado] = eventos.filter((e) => e.tipo === 'turno.devuelto')
  assert.equal(restaurado.casilla.codigo, b.codigo, 'el televisor vuelve a mostrar a B')
  assert.ok(!eventos.some((e) => e.tipo === 'turno.llamado'), 'sin campana: no es un llamado nuevo')
  assert.ok(eventos.some((e) => e.tipo === 'fila.cambiada'), 'la fila del doctor se actualiza')

  // Y el siguiente "Siguiente" llama otra vez a C, no a D.
  const otraVez = await llamar(sala, b.id)
  assert.equal(otraVez.id, c.id)
})

test('doble clic en Retroceder: el segundo no retrocede otro paso', async () => {
  const sala = await consultorio()
  const a = await enEspera(sala.doctor.id, '08:00')
  await enEspera(sala.doctor.id, '08:15')
  await llamar(sala, null) // A
  const b = await llamar(sala, a.id) // B, A cerrado solo

  const visto = { turnoAbiertoId: b.id, restaurarId: a.id }
  await repo.retrocederTurno(sala.doctor.id, visto)
  await assert.rejects(() => repo.retrocederTurno(sala.doctor.id, visto), (e) => e.status === 409)
  assert.equal((await repo.turnoAbierto({ profesionalId: sala.doctor.id }, HOY)).id, a.id)
})

test('"Atendido" o "No se presento" por error: el paciente vuelve a atencion y su cita tambien', async () => {
  const sala = await consultorio()
  const a = await enEspera(sala.doctor.id, '08:00')
  await llamar(sala, null)
  await repo.marcarAtendido(a.id, sala.doctor.id)

  await retroceder(sala)
  const abierto = await repo.turnoAbierto({ profesionalId: sala.doctor.id }, HOY)
  assert.equal(abierto.id, a.id)
  assert.equal(abierto.estado, 'LLAMADO')
  assert.equal(abierto.cerradoEn, null)
  const agenda = await repo.agendaProfesional(sala.doctor.id, HOY)
  assert.equal(agenda.find((i) => i.codigo === a.codigo).estado, 'LLAMADO')

  await repo.marcarAusente(a.id, sala.doctor.id)
  await retroceder(sala)
  assert.equal((await repo.turnoAbierto({ profesionalId: sala.doctor.id }, HOY)).id, a.id)
})

test('retroceder varias veces va hacia atras paso a paso', async () => {
  const sala = await consultorio()
  const a = await enEspera(sala.doctor.id, '08:00')
  const b = await enEspera(sala.doctor.id, '08:15')
  const c = await enEspera(sala.doctor.id, '08:30')
  await llamar(sala, null) // A
  await llamar(sala, a.id) // B
  await llamar(sala, b.id) // C (doble clic de mas)

  await retroceder(sala) // vuelve B, C a la fila
  await retroceder(sala) // vuelve A, B a la fila
  assert.equal((await repo.turnoAbierto({ profesionalId: sala.doctor.id }, HOY)).id, a.id)
  const pendientes = await repo.listarPendientes({ profesionalId: sala.doctor.id })
  assert.deepEqual(pendientes.map((x) => x.id), [b.id, c.id])
})

test('sin nada que retroceder se dice claro, sin tocar nada', async () => {
  const sala = await consultorio()
  await enEspera(sala.doctor.id, '08:00')
  assert.equal(await repo.planDeRetroceso(sala.doctor.id), null)
  await assert.rejects(
    () => repo.retrocederTurno(sala.doctor.id, { turnoAbiertoId: null, restaurarId: null }),
    (e) => e.status === 400,
  )
})

test('el aviso al televisor viaja por el canal y le llega al consultorio correcto', () => {
  const casilla = { moduloId: 'm1', moduloNombre: 'CONS 01', servicioId: 's', servicioNombre: 'S', codigo: 'C-010', horaLlamado: null, vecesLlamado: 1 }
  const leido = interpretarMensaje(JSON.stringify({ tipo: 'turno.devuelto', moduloId: 'm1', puesto: 'm1~p1', casilla }))
  assert.equal(leido?.tipo, 'turno.devuelto')
  assert.ok(interpretarMensaje(JSON.stringify({ tipo: 'turno.devuelto', moduloId: 'm1', puesto: 'm1~p1', casilla: null })))
  assert.equal(interpretarMensaje(JSON.stringify({ tipo: 'turno.devuelto', moduloId: 'm1' })), null)
  assert.ok(afectaALaFila(leido, { profesionalId: 'p1', moduloId: 'm1' }))
  assert.ok(!afectaALaFila(leido, { profesionalId: 'p2', moduloId: 'm2' }))
})

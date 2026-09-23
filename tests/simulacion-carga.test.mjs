// La simulacion de carga se prepara en el servidor, en una sola peticion, y no
// crea citas: usa las de hoy o, si hoy no hay, las del ultimo dia con citas.
//
// El fallo real: el panel hacia desde el navegador mas de cien peticiones
// (creando citas de relleno) y se quedaba en "Preparando 10 consultorios...".
// Y como casi todos los doctores tenian el mismo consultorio, los que llamaban
// a la vez chocaban con "consultorio ocupado".
import assert from 'node:assert/strict'
import test from 'node:test'

const { turnoRepository } = await import('./repositorios-en-memoria.mjs')
const { prepararSimulacionDeCarga, limpiarSimulacionDeCarga, PREFIJO_CONSULTORIO_SIMULADO } = await import(
  '@/lib/turnos/simulacion-carga'
)
const { diaColombia, ahoraISO } = await import('@/lib/turnos/tiempo')




test('prepara en una sola llamada: doctores con enlace, consultorios distintos y pacientes en espera', async () => {
  const preparada = await prepararSimulacionDeCarga(turnoRepository, { pacientesPorConsultorio: 2, consultorios: 10 })

  assert.ok(preparada.doctores.length > 0, preparada.avisos.join(' / '))
  assert.equal(preparada.citasDe, diaColombia(ahoraISO()))
  assert.ok(preparada.doctores.every((d) => d.moduloId), 'cada doctor tiene su consultorio real')
  for (const d of preparada.doctores) {
    assert.ok(d.token, 'cada doctor tiene su enlace')
    assert.ok(d.pacientesEnEspera > 0 && d.pacientesEnEspera <= 2, `${d.nombre}: ${d.pacientesEnEspera}`)
  }
})

test('no crea citas: prepararla dos veces deja el mismo numero de citas de hoy', async () => {
  const hoy = diaColombia(ahoraISO())
  await prepararSimulacionDeCarga(turnoRepository, { pacientesPorConsultorio: 3, consultorios: 10 })
  const antes = (await turnoRepository.listarCitas({ fecha: hoy })).length
  await prepararSimulacionDeCarga(turnoRepository, { pacientesPorConsultorio: 3, consultorios: 10 })

  assert.equal((await turnoRepository.listarCitas({ fecha: hoy })).length, antes)
})

test('si hoy no hay citas, usa las del ultimo dia con citas, a la misma hora', async () => {
  const hoy = diaColombia(ahoraISO())
  // Se corren las citas de hoy a hace tres dias: hoy queda vacio.
  const citas = await turnoRepository.listarCitas({ fecha: hoy })
  const horas = citas.map((c) => c.horaCita.slice(11, 16)).sort()
  for (const cita of citas) cita.horaCita = new Date(Date.parse(cita.horaCita) - 3 * 86_400_000).toISOString()
  assert.equal((await turnoRepository.listarCitas({ fecha: hoy })).length, 0)

  const traidas = await turnoRepository.traerCitasDelUltimoDia(hoy)

  assert.equal(traidas.movidas, citas.length)
  const deHoy = await turnoRepository.listarCitas({ fecha: hoy })
  assert.deepEqual(deHoy.map((c) => c.horaCita.slice(11, 16)).sort(), horas)
  assert.ok(deHoy.every((c) => c.estado === 'PROGRAMADA'))
})


test('se simulan tantos consultorios como se pidan, si hay doctores con citas', async () => {
  const preparada = await prepararSimulacionDeCarga(turnoRepository, { pacientesPorConsultorio: 1, consultorios: 3 })
  assert.equal(preparada.doctores.length, 3)
  await limpiarSimulacionDeCarga(turnoRepository)
})

test('no crea consultorios: cada doctor usa el suyo, y se borran los temporales viejos', async () => {
  const antes = (await turnoRepository.listarModulos()).length
  await turnoRepository.crearModulo({ nombre: `${PREFIJO_CONSULTORIO_SIMULADO}99 - VIEJO`, servicioId: null, activo: true })
  await prepararSimulacionDeCarga(turnoRepository, { pacientesPorConsultorio: 1, consultorios: 20 })

  const modulos = await turnoRepository.listarModulos()
  assert.equal(modulos.length, antes)
  assert.equal(modulos.some((m) => m.nombre.startsWith(PREFIJO_CONSULTORIO_SIMULADO)), false)
  await limpiarSimulacionDeCarga(turnoRepository)
})

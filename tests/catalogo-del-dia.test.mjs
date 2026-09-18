// Que parte del catalogo trabaja HOY, que no es lo mismo que que existe.
//
// EL PROBLEMA QUE CUBREN ESTAS PRUEBAS. La carga diaria del reporte del
// hospital da de alta lo que encuentra —servicios, consultorios, doctores— y no
// vuelve a apagarlo nunca, y hace bien: un reporte filtrado por un doctor no
// puede desactivar medio hospital. La consecuencia es que el campo `activo`
// acaba significando "alguna vez aparecio en un archivo". Un martes cualquiera
// el hospital atiende odontologia en tres consultorios, pero en el catalogo hay
// seis servicios y veinte consultorios, todos en verde.
//
// Quien responde de verdad "quien trabaja este dia" son las citas de ese dia, y
// es lo que se comprueba aqui.
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

function diaColombia(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(fecha)
}

const HOY = diaColombia()
// Se usa el dia SIGUIENTE y no el anterior: el sistema no deja agendar en un
// dia que ya paso, que es otra regla del dominio y no la que se prueba aqui.
const MANANA = diaColombia(new Date(Date.now() + 24 * 60 * 60 * 1000))

const enFranja = (hora, dia = HOY) => new Date(`${dia}T${hora}:00-05:00`).toISOString()

/** Un consultorio con su doctor, recien creados, para no heredar filas. */
let creados = 0
async function consultorioConDoctor(repo, servicioId) {
  creados += 1
  const modulo = await repo.crearModulo({
    nombre: `Consultorio catalogo ${creados}`,
    servicioId,
    activo: true,
  })
  const doctor = await repo.crearProfesional({
    nombre: `Dra. Catalogo ${creados}`,
    servicioId,
    jornada: 'COMPLETA',
    moduloId: modulo.id,
  })
  return { modulo, doctor }
}

test('el consultorio activo que hoy no tiene citas no figura como que atendio', async () => {
  const repo = new InMemoryTurnoRepository()
  const { modulo: conAgenda, doctor } = await consultorioConDoctor(repo, 'srv-consulta-externa')
  const { modulo: vacio } = await consultorioConDoctor(repo, 'srv-consulta-externa')

  await repo.crearCita({
    documentoPaciente: '1010101010',
    nombrePaciente: 'Paciente De Hoy',
    profesionalId: doctor.id,
    horaCita: enFranja('08:00'),
  })

  const actividad = await repo.actividadDelCatalogo(HOY)

  assert.ok(actividad.porModulo[conAgenda.id], 'el consultorio con citas tiene que aparecer')
  assert.equal(
    actividad.porModulo[vacio.id],
    undefined,
    'el consultorio sin citas no aparece, aunque este activo en el catalogo',
  )

  // Y sigue activo en el catalogo: esto informa, no da de baja a nadie.
  const modulos = await repo.listarModulos(undefined, true)
  assert.equal(modulos.find((m) => m.id === vacio.id).activo, true)
})

test('las citas de otro dia no cuentan como actividad de hoy', async () => {
  const repo = new InMemoryTurnoRepository()
  const { modulo, doctor } = await consultorioConDoctor(repo, 'srv-consulta-externa')

  await repo.crearCita({
    documentoPaciente: '2020202020',
    nombrePaciente: 'Paciente De Otro Dia',
    profesionalId: doctor.id,
    horaCita: enFranja('09:00', MANANA),
  })

  const hoy = await repo.actividadDelCatalogo(HOY)
  const otroDia = await repo.actividadDelCatalogo(MANANA)

  assert.equal(hoy.porModulo[modulo.id], undefined, 'hoy ese consultorio no atiende')
  assert.ok(otroDia.porModulo[modulo.id], 'el dia que si tiene citas se puede consultar aparte')
  assert.equal(otroDia.porServicio['srv-consulta-externa'].citas, 1)
})

test('el rango de horas del dia sale de la primera y la ultima cita', async () => {
  const repo = new InMemoryTurnoRepository()
  const { modulo, doctor } = await consultorioConDoctor(repo, 'srv-consulta-externa')

  for (const hora of ['10:00', '07:30', '11:00']) {
    await repo.crearCita({
      documentoPaciente: `3${hora.replace(':', '')}00000`,
      nombrePaciente: `Paciente ${hora}`,
      profesionalId: doctor.id,
      horaCita: enFranja(hora),
    })
  }

  const { porModulo } = await repo.actividadDelCatalogo(HOY)

  assert.equal(porModulo[modulo.id].citas, 3)
  assert.equal(porModulo[modulo.id].desde, '07:30')
  assert.equal(porModulo[modulo.id].hasta, '11:00')
})

test('una cita cancelada no hace que el dia cuente como trabajado', async () => {
  const repo = new InMemoryTurnoRepository()
  const { modulo, doctor } = await consultorioConDoctor(repo, 'srv-consulta-externa')

  const cita = await repo.crearCita({
    documentoPaciente: '4040404040',
    nombrePaciente: 'Paciente Que Cancela',
    profesionalId: doctor.id,
    horaCita: enFranja('08:30'),
  })
  await repo.cancelarCita(cita.id, { motivo: 'El paciente aviso que no viene' })

  const { porModulo } = await repo.actividadDelCatalogo(HOY)

  assert.equal(
    porModulo[modulo.id],
    undefined,
    'un dia cuyas citas se cancelaron todas es un dia que no se trabajo',
  )
})

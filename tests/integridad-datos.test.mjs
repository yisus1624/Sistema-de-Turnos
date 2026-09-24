// Integridad de los datos cuando hay dos personas trabajando a la vez.
//
// Las carreras de verdad (dos peticiones simultaneas contra PostgreSQL) NO se
// pueden reproducir aqui: el repositorio en memoria es monohilo y nunca hay
// dos escrituras entrelazadas. Lo que si se puede probar, y es donde estaba el
// fallo, son las DECISIONES que toma el sistema cuando el mundo cambio en
// medio: que mensaje se le da al funcionario segun el estado que se encontro
// al escribir, y como se traduce el rechazo del indice unico de la base a algo
// que se entienda. Esas decisiones viven en funciones puras a proposito, para
// poder comprobarlas sin base de datos.
import assert from 'node:assert/strict'
import test from 'node:test'
import { Prisma } from '@prisma/client'

const { motivoQueImpideCancelar, motivoQueImpideReprogramar } = await import(
  '@/lib/turnos/cita-transiciones'
)
const { claveDelChoque, mensajeDeChoque } = await import('@/lib/turnos/choques-unicos')

// ---------------------------------------------------------------------------
// Que impide cancelar o reprogramar, segun el estado que se encontro al escribir
// ---------------------------------------------------------------------------

test('una cita PROGRAMADA no tiene nada que impida cancelarla ni moverla', () => {
  assert.equal(motivoQueImpideCancelar('PROGRAMADA'), null)
  assert.equal(motivoQueImpideReprogramar('PROGRAMADA'), null)
})

test('si el paciente ya registro su llegada, el aviso lo dice con esas palabras', () => {
  const motivo = motivoQueImpideCancelar('PRESENTADO')
  assert.ok(motivo)
  assert.match(motivo, /llegada/i)

  const alMover = motivoQueImpideReprogramar('PRESENTADO')
  assert.ok(alMover)
  assert.match(alMover, /llegada/i)
})

test('una cita ya cancelada o ya atendida avisa de su estado real, no del generico', () => {
  assert.match(motivoQueImpideCancelar('CANCELADA'), /ya estaba cancelada/i)
  assert.match(motivoQueImpideCancelar('ATENDIDA'), /atendida/i)
  assert.match(motivoQueImpideReprogramar('CANCELADA'), /cancelada/i)
  assert.match(motivoQueImpideReprogramar('ATENDIDA'), /atendida/i)
})

test('los avisos estan en español y sin codigos de estado crudos', () => {
  for (const estado of ['PRESENTADO', 'CANCELADA', 'ATENDIDA']) {
    for (const motivo of [motivoQueImpideCancelar(estado), motivoQueImpideReprogramar(estado)]) {
      assert.ok(motivo)
      assert.doesNotMatch(motivo, /PROGRAMADA|PRESENTADO|updateMany|P2002/)
    }
  }
})

// ---------------------------------------------------------------------------
// Traduccion del rechazo del indice unico
// ---------------------------------------------------------------------------

function choqueDeUnico(objetivo, modelName = 'Servicio') {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.0.0',
    meta: objetivo === undefined ? {} : { modelName, target: objetivo },
  })
}

test('el choque de un indice unico se identifica por la columna que lo provoco', () => {
  assert.equal(claveDelChoque(choqueDeUnico(['prefijo'])), 'prefijo')
})

test('el choque de un indice con nombre propio se identifica por ese nombre', () => {
  // Con Prisma 6 y PostgreSQL 16 el error NO trae el nombre del indice: trae
  // sus columnas o su expresion, y el modelo (comprobado contra la base).
  assert.equal(
    claveDelChoque(choqueDeUnico(['fecha', 'profesionalId', 'horaCita'], 'Cita')),
    'citas_cupo_manual_unico',
  )
  assert.equal(
    claveDelChoque(choqueDeUnico(['fecha', 'documentoPaciente', 'profesionalId', 'horaCita'], 'Cita')),
    'citaDelDia',
  )
  assert.equal(
    claveDelChoque(choqueDeUnico(['lower(TRIM(BOTH FROM nombre))'], 'Servicio')),
    'servicios_nombre_normalizado_unico',
  )
})

test('lo que no es un choque de unicidad no se confunde con uno', () => {
  const noEncontrado = new Prisma.PrismaClientKnownRequestError('No encontrado', {
    code: 'P2025',
    clientVersion: '6.0.0',
  })
  assert.equal(claveDelChoque(noEncontrado), null)
  assert.equal(claveDelChoque(new Error('se cayo la red')), null)
  assert.equal(claveDelChoque(null), null)
})

test('un choque sin detalle de columna no se traduce a un mensaje equivocado', () => {
  assert.equal(claveDelChoque(choqueDeUnico(undefined)), null)
  assert.equal(mensajeDeChoque(choqueDeUnico(undefined), { prefijo: 'El prefijo ya se usa.' }), null)
})

test('el choque se traduce al mensaje del negocio que corresponde a esa columna', () => {
  const mensajes = { prefijo: 'El prefijo O ya lo usa otro servicio.', nombre: 'Ya existe.' }
  assert.equal(mensajeDeChoque(choqueDeUnico(['prefijo']), mensajes), mensajes.prefijo)
  assert.equal(mensajeDeChoque(choqueDeUnico(['nombre']), mensajes), mensajes.nombre)
})

test('un choque de una columna sin mensaje propio no se disfraza de otro error', () => {
  // Preferimos que salga el error tecnico a contarle al funcionario algo que no
  // es: un mensaje equivocado le hace corregir el campo que no toca.
  assert.equal(mensajeDeChoque(choqueDeUnico(['claveExterna']), { prefijo: 'x' }), null)
})

// ---------------------------------------------------------------------------
// Las mismas reglas, vistas desde el repositorio (memoria y PostgreSQL usan la
// misma funcion, asi que los dos avisan igual)
// ---------------------------------------------------------------------------

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

function diaColombia(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(fecha)
}

const HOY = diaColombia()

function enFranja(hora) {
  return new Date(`${HOY}T${hora}:00-05:00`).toISOString()
}

const repo = new InMemoryTurnoRepository()

let creados = 0

/** Un doctor recien creado con una cita de hoy, para no chocar con lo sembrado. */
async function citaDeHoy(hora = '08:00') {
  creados += 1
  const doctor = await repo.crearProfesional({
    nombre: `Dr. Integridad ${creados}`,
    servicioId: 'srv-consulta-externa',
    jornada: 'COMPLETA',
  })
  return repo.crearCita({
    documentoPaciente: String(940000 + creados),
    nombrePaciente: `Paciente Integridad ${creados}`,
    profesionalId: doctor.id,
    horaCita: enFranja(hora),
  })
}

test('cancelar una cita cuyo paciente ya llego se rechaza con el aviso de la llegada', async () => {
  const cita = await citaDeHoy()
  await repo.registrarLlegada(cita.id)

  await assert.rejects(() => repo.cancelarCita(cita.id), /llegada/i)
})

test('mover una cita cuyo paciente ya llego se rechaza para no dejar el turno colgado', async () => {
  const cita = await citaDeHoy()
  await repo.registrarLlegada(cita.id)

  await assert.rejects(() => repo.reprogramarCita(cita.id, { horaCita: enFranja('16:00') }), /llegada/i)
})

// ---------------------------------------------------------------------------
// Dos administradores guardando la configuracion a la vez
// ---------------------------------------------------------------------------

test('guardar la configuracion devuelve una marca nueva cada vez', async () => {
  const repo = new InMemoryTurnoRepository()
  const antes = await repo.configuracion()
  const despues = await repo.guardarConfiguracion(
    { volumen: 0.7 },
    { visto: antes.actualizadoEn },
  )

  assert.ok(antes.actualizadoEn, 'la configuracion viene firmada con la hora de su ultimo cambio')
  assert.notEqual(despues.actualizadoEn, antes.actualizadoEn)
})

test('el segundo administrador no revierte en silencio lo que acaba de guardar el primero', async () => {
  const repo = new InMemoryTurnoRepository()
  // Los dos abren la pantalla y ven la misma configuracion.
  const loQueVenLosDos = await repo.configuracion()

  await repo.guardarConfiguracion({ jornadaTardeFin: '18:00' }, { visto: loQueVenLosDos.actualizadoEn })

  await assert.rejects(
    () => repo.guardarConfiguracion({ mensajePie: 'Otro texto' }, { visto: loQueVenLosDos.actualizadoEn }),
    /cambio la configuracion/i,
  )

  const guardada = await repo.configuracion()
  assert.equal(guardada.jornadaTardeFin, '18:00', 'lo del primero sigue puesto')
  assert.notEqual(guardada.mensajePie, 'Otro texto')
})

test('guardar con la marca al dia si se acepta', async () => {
  const repo = new InMemoryTurnoRepository()
  const primera = await repo.guardarConfiguracion(
    { mensajePie: 'Uno' },
    { visto: (await repo.configuracion()).actualizadoEn },
  )
  const segunda = await repo.guardarConfiguracion({ mensajePie: 'Dos' }, { visto: primera.actualizadoEn })

  assert.equal(segunda.mensajePie, 'Dos')
})

test('una cita ya cancelada no se cancela dos veces', async () => {
  const cita = await citaDeHoy()
  await repo.cancelarCita(cita.id)

  await assert.rejects(() => repo.cancelarCita(cita.id), /ya estaba cancelada/i)
})

// Las rutas cuentan la verdad cuando se pierde una respuesta.
//
// El repositorio decide (ver `turnos-sin-perdidas.test.mjs`); aqui se prueba que
// la ruta entregue al cliente lo que necesita para ponerse al dia —el turno
// real en un 409, el comprobante en una llegada repetida— y que la auditoria
// no apunte dos veces algo que se hizo una sola.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

// ANTES QUE NADA: sin esto las pruebas escriben en la base real.
const { turnoRepository } = await import('./repositorios-en-memoria.mjs')

const apuntes = []
const sesion = {
  user: {
    id: 'usuario-operador',
    name: 'Olga Operadora',
    usuario: 'olga',
    rol: 'ADMINISTRADOR',
    area: null,
    secciones: ['/operador', '/operador/admisiones'],
  },
}

mock.module('@/lib/auth', { namedExports: { auth: async () => sesion } })
mock.module('@/lib/seguridad/registro', {
  namedExports: {
    registrarEvento: async (evento) => {
      apuntes.push(evento)
    },
    contextoPeticion: async () => ({ ip: '10.0.0.7', agente: 'pruebas' }),
    limitarIntentos: () => ({ permitido: true, reintentarEnSegundos: 0 }),
    limpiarIntentos: () => {},
    listarEventos: async () => [],
    tiposDeEvento: async () => [],
    confiarEnProxy: false,
  },
})
mock.module('next/headers', { namedExports: { headers: async () => new Headers() } })

const rutaLlamarConsultorio = await import('@/app/api/consultorio/llamar-siguiente/route')
const rutaLlegada = await import('@/app/api/turnos/citas/llegada/route')
const rutaAtendido = await import('@/app/api/turnos/[id]/atendido/route')
const rutaPendientes = await import('@/app/api/turnos/pendientes/route')

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())

function post(cuerpo, cookie) {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
}

const parametros = (valores) => ({ params: Promise.resolve(valores) })
const contar = (tipo) => apuntes.filter((a) => a.tipo === tipo).length

let creados = 0
async function doctorConConsultorio() {
  creados += 1
  const modulo = await turnoRepository.crearModulo({
    nombre: `Consultorio rutas ${creados}`,
    servicioId: 'srv-consulta-externa',
    activo: true,
  })
  const doctor = await turnoRepository.crearProfesional({
    nombre: `Dr. Rutas ${creados}`,
    servicioId: 'srv-consulta-externa',
    jornada: 'COMPLETA',
    moduloId: modulo.id,
  })
  const { token } = await turnoRepository.crearAccesoProfesional(doctor.id, 60)
  return { doctor, modulo, cookie: `turnos_consultorio=${token}` }
}

let documentos = 600000
async function citaDeHoy(profesionalId, hora) {
  documentos += 1
  return turnoRepository.crearCita({
    documentoPaciente: String(documentos),
    nombrePaciente: `Paciente ${documentos}`,
    profesionalId,
    horaCita: new Date(`${HOY}T${hora}:00-05:00`).toISOString(),
  })
}

async function ventanilla() {
  creados += 1
  const servicio = await turnoRepository.crearServicio({
    nombre: `Caja ${creados}`,
    prefijo: `K${creados}`,
    modoFila: 'COMPARTIDA',
    activo: true,
  })
  const modulo = await turnoRepository.crearModulo({ nombre: `Caja ${creados}`, servicioId: servicio.id, activo: true })
  return { servicio, modulo }
}

test('llamar con un turno abierto distinto al real: 409 con el turno real para ponerse al dia', async () => {
  const { doctor, modulo, cookie } = await doctorConConsultorio()
  await turnoRepository.registrarLlegada((await citaDeHoy(doctor.id, '08:00')).id)
  await turnoRepository.registrarLlegada((await citaDeHoy(doctor.id, '08:15')).id)

  const primera = await rutaLlamarConsultorio.POST(post({ moduloId: modulo.id, turnoAbiertoId: null }, cookie))
  const { turno } = await primera.json()

  const repetida = await rutaLlamarConsultorio.POST(post({ moduloId: modulo.id, turnoAbiertoId: null }, cookie))
  const cuerpo = await repetida.json()

  assert.equal(repetida.status, 409)
  assert.equal(cuerpo.turnoActual.id, turno.id)
  assert.match(cuerpo.error, new RegExp(turno.codigo))
})

test('registrar la llegada dos veces devuelve el comprobante y la auditoria se apunta una vez', async () => {
  const { doctor } = await doctorConConsultorio()
  const cita = await citaDeHoy(doctor.id, '09:00')
  const antes = contar('LLEGADA_REGISTRADA')

  const primera = await (await rutaLlegada.POST(post({ citaId: cita.id }))).json()
  const segunda = await rutaLlegada.POST(post({ citaId: cita.id }))
  const cuerpo = await segunda.json()

  assert.equal(segunda.status, 200)
  assert.equal(cuerpo.yaRegistrada, true)
  assert.equal(cuerpo.comprobante.codigo, primera.comprobante.codigo)
  assert.equal(contar('LLEGADA_REGISTRADA') - antes, 1)
})

test('"Atendido" repetido: dos veces 200 y un solo apunte de auditoria', async () => {
  const { servicio, modulo } = await ventanilla()
  await turnoRepository.generarTurnoDeVentanilla(servicio.id)
  const llamado = await turnoRepository.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: sesion.user.id,
  })
  const antes = contar('TURNO_ATENDIDO')

  const r1 = await rutaAtendido.POST(post(), parametros({ id: llamado.id }))
  const r2 = await rutaAtendido.POST(post(), parametros({ id: llamado.id }))

  assert.deepEqual([r1.status, r2.status], [200, 200])
  assert.equal(contar('TURNO_ATENDIDO') - antes, 1)
})

function pendientes(consulta) {
  return rutaPendientes.GET(new Request(`http://localhost/api/turnos/pendientes?${new URLSearchParams(consulta)}`))
}

test('pendientes con la ventanilla devuelve el turno abierto de ESE funcionario', async () => {
  const { servicio, modulo } = await ventanilla()
  await turnoRepository.generarTurnoDeVentanilla(servicio.id)
  const llamado = await turnoRepository.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: sesion.user.id,
  })

  const cuerpo = await (await pendientes({ servicioId: servicio.id, moduloId: modulo.id })).json()

  assert.equal(cuerpo.turnoActual.id, llamado.id)
})

test('pendientes rechaza una ventanilla que no es de ese servicio', async () => {
  const { servicio } = await ventanilla()
  const respuesta = await pendientes({ servicioId: servicio.id, moduloId: 'mod-consultorio-1' })
  assert.equal(respuesta.status, 400)
})

test('pendientes rechaza parametros desmedidos', async () => {
  const respuesta = await pendientes({ servicioId: 'x'.repeat(500) })
  assert.equal(respuesta.status, 400)
})

test('pendientes sin permiso de operador: 403', async () => {
  const secciones = sesion.user.secciones
  sesion.user.secciones = ['/admin/citas']
  sesion.user.rol = 'OPERADOR'
  try {
    const respuesta = await pendientes({ servicioId: 'srv-consulta-externa' })
    assert.equal(respuesta.status, 403)
  } finally {
    sesion.user.secciones = secciones
    sesion.user.rol = 'ADMINISTRADOR'
  }
})

// --- Correcciones de QA -------------------------------------------------------

const rutaLlamarOperador = await import('@/app/api/turnos/llamar-siguiente/route')
const { ErrorPasajero } = await import('@/lib/turnos/errores')

test('una pantalla que no manda el turno que ve (codigo viejo) recibe 400 y se le pide recargar', async () => {
  const { modulo, cookie } = await doctorConConsultorio()

  const respuesta = await rutaLlamarConsultorio.POST(post({ moduloId: modulo.id }, cookie))
  const cuerpo = await respuesta.json()

  assert.equal(respuesta.status, 400)
  assert.match(cuerpo.error, /recarga la pagina/i)
})

test('lo mismo en la ventanilla del operador', async () => {
  const { servicio, modulo } = await ventanilla()
  const respuesta = await rutaLlamarOperador.POST(post({ servicioId: servicio.id, moduloId: modulo.id }))
  assert.equal(respuesta.status, 400)
})

test('el operador no puede cerrar por id el paciente de un doctor', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  await turnoRepository.registrarLlegada((await citaDeHoy(doctor.id, '10:00')).id)
  const delDoctor = await turnoRepository.llamarSiguiente({
    profesionalId: doctor.id,
    moduloId: modulo.id,
    funcionarioId: doctor.id,
  })

  const respuesta = await rutaAtendido.POST(post(), parametros({ id: delDoctor.id }))

  assert.equal(respuesta.status, 403)
  const [enHistorico] = await turnoRepository.historico({ codigo: delDoctor.codigo, fecha: HOY })
  assert.equal(enHistorico.estado, 'LLAMADO', 'el paciente del doctor sigue en atencion')
})

test('un id de turno desmedido no llega al repositorio', async () => {
  const respuesta = await rutaAtendido.POST(post(), parametros({ id: 'x'.repeat(500) }))
  assert.equal(respuesta.status, 404)
})

test('pendientes rechaza la fila de un servicio por cita y ya no acepta profesional', async () => {
  assert.equal((await pendientes({ servicioId: 'srv-consulta-externa' })).status, 400)
  assert.equal((await pendientes({ profesionalId: 'pro-perez' })).status, 400)
})

test('un choque pasajero de la base llega como 503 "vuelve a intentarlo", no como fallo del sistema', async () => {
  const { servicio, modulo } = await ventanilla()
  await turnoRepository.generarTurnoDeVentanilla(servicio.id)
  const llamado = await turnoRepository.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: sesion.user.id,
  })
  const original = turnoRepository.marcarAtendido
  turnoRepository.marcarAtendido = async () => {
    throw new ErrorPasajero()
  }
  try {
    const respuesta = await rutaAtendido.POST(post(), parametros({ id: llamado.id }))
    const cuerpo = await respuesta.json()

    assert.equal(respuesta.status, 503)
    assert.match(cuerpo.error, /vuelve a intentarlo/i)
  } finally {
    turnoRepository.marcarAtendido = original
  }
})

test('con el techo de consultas caras lleno, el historico responde 503 con su mensaje, no "fallo del sistema"', async () => {
  const { ejecutarConsultaPesada } = await import('@/lib/seguridad/freno-consultas')
  const rutaHistorico = await import('@/app/api/turnos/historico/route')
  let soltar
  const ocupadas = new Promise((resolver) => {
    soltar = resolver
  })
  const enCurso = Array.from({ length: 4 }, () => ejecutarConsultaPesada(() => ocupadas))
  try {
    const respuesta = await rutaHistorico.GET(new Request('http://localhost/api/turnos/historico'))
    const cuerpo = await respuesta.json()

    assert.equal(respuesta.status, 503)
    assert.match(cuerpo.error, /otros informes/i)
  } finally {
    soltar()
    await Promise.all(enCurso)
  }
})

test('un error cualquiera con status 503 no deja pasar su texto', async () => {
  const { apiError } = await import('@/lib/permissions/session')
  const respuesta = apiError(Object.assign(new Error('connection to db-interna:5432 refused'), { status: 503 }))
  const cuerpo = await respuesta.json()

  assert.equal(respuesta.status, 500)
  assert.doesNotMatch(cuerpo.error, /db-interna/)
})

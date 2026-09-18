// Las RUTAS dejan rastro de lo que cambian.
//
// No se prueba que el registro funcione —eso es de `lib/seguridad/registro`—
// sino que cada accion que cambia algo LLAME al registro y le pase lo que hace
// falta para contestar despues quien hizo que, sobre que, y con que valores.
// Los huecos que cubre son todos del mismo tipo: la accion salia bien y no
// quedaba nada escrito, o quedaba escrito algo que no se puede leer (ids
// crudos) ni deshacer (solo el despues).
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

// ANTES QUE NADA, y antes de cualquier route handler: sin esto las pruebas
// escriben en la base de datos REAL del hospital.
const { turnoRepository } = await import('./repositorios-en-memoria.mjs')

/** Lo que se fue apuntando en el registro durante la prueba. */
const apuntes = []

/** La sesion que devuelve `auth()`. Las rutas del consultorio no la usan. */
const sesion = {
  user: {
    id: 'usuario-admin',
    name: 'Ana Administradora',
    usuario: 'ana',
    rol: 'ADMINISTRADOR',
    area: null,
    // Lista explicita: '/operador' esta retirada del menu del hospital, y sin
    // nombrarla aqui las rutas de llamar y repetir responderian 403 y no se
    // podria comprobar su rastro.
    secciones: ['/operador', '/admin/pantalla', '/admin/profesionales', '/admin/enlaces'],
  },
}

mock.module('@/lib/auth', { namedExports: { auth: async () => sesion } })

// El registro se sustituye entero: escribe en la base con Prisma, y lo que hay
// que comprobar aqui es lo que las rutas le entregan.
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

const consultorioLlamar = await import('@/app/api/consultorio/[token]/llamar-siguiente/route')
const consultorioRepetir = await import('@/app/api/consultorio/[token]/[turnoId]/repetir/route')
const operadorLlamar = await import('@/app/api/turnos/llamar-siguiente/route')
const operadorRepetir = await import('@/app/api/turnos/[id]/repetir/route')
const rutaConfiguracion = await import('@/app/api/turnos/configuracion/route')
const rutaProfesional = await import('@/app/api/turnos/profesionales/[id]/route')
const rutaAcceso = await import('@/app/api/profesionales/[id]/acceso/route')
const rutaRevocar = await import('@/app/api/profesionales/accesos/[id]/route')
const rutaVentanilla = await import('@/app/api/turnos/ventanilla/route')

const SERVICIO = 'srv-consulta-externa'
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())

const parametros = (valores) => ({ params: Promise.resolve(valores) })

function peticion(cuerpo) {
  return new Request('http://localhost/api', {
    method: 'POST',
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
}

/** El ultimo apunte de un tipo, o undefined si no se escribio ninguno. */
function ultimoApunte(tipo) {
  return [...apuntes].reverse().find((evento) => evento.tipo === tipo)
}

let creados = 0
async function doctorConConsultorio() {
  creados += 1
  const modulo = await turnoRepository.crearModulo({
    nombre: `Consultorio rastro ${creados}`,
    servicioId: SERVICIO,
    activo: true,
  })
  const doctor = await turnoRepository.crearProfesional({
    nombre: `Dr. Rastro ${creados}`,
    servicioId: SERVICIO,
    jornada: 'COMPLETA',
    moduloId: modulo.id,
  })
  return { doctor, modulo }
}

let documentos = 900000
async function pacienteEnEspera(profesionalId, hora = '08:00') {
  documentos += 1
  const cita = await turnoRepository.crearCita({
    documentoPaciente: String(documentos),
    nombrePaciente: `Paciente ${documentos}`,
    profesionalId,
    horaCita: new Date(`${HOY}T${hora}:00-05:00`).toISOString(),
    usuarioId: 'usuario-mostrador',
  })
  return turnoRepository.registrarLlegada(cita.id)
}

async function tokenDe(profesionalId) {
  const { token } = await turnoRepository.crearAccesoProfesional(profesionalId, 60)
  return token
}

// --- 4.1 Llamar y repetir, el camino que no pasa por usuario y contrasena ---

test('llamar al siguiente desde el consultorio deja quien, a quien y desde donde', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  await pacienteEnEspera(doctor.id)
  const token = await tokenDe(doctor.id)

  const respuesta = await consultorioLlamar.POST(
    peticion({ moduloId: modulo.id }),
    parametros({ token }),
  )
  const { turno } = await respuesta.json()
  assert.equal(respuesta.status, 200)

  const apunte = ultimoApunte('TURNO_LLAMADO')
  assert.ok(apunte, 'el llamado tiene que quedar escrito')
  assert.equal(apunte.exito, true)
  assert.equal(apunte.identificador, turno.codigo)
  assert.equal(apunte.ip, '10.0.0.7')
  assert.equal(apunte.detalle.profesional, doctor.nombre)
  assert.equal(apunte.detalle.modulo, modulo.nombre)
})

test('repetir el llamado queda como repeticion y dice cuantas van', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  await pacienteEnEspera(doctor.id)
  const token = await tokenDe(doctor.id)

  const llamada = await consultorioLlamar.POST(peticion({ moduloId: modulo.id }), parametros({ token }))
  const { turno } = await llamada.json()

  const respuesta = await consultorioRepetir.POST(
    peticion(),
    parametros({ token, turnoId: turno.id }),
  )
  assert.equal(respuesta.status, 200)

  const apunte = ultimoApunte('TURNO_REPETIDO')
  assert.ok(apunte, 'repetir el llamado tiene que quedar escrito')
  assert.equal(apunte.identificador, turno.codigo)
  assert.equal(apunte.detalle.vecesLlamado, 2)
  assert.equal(apunte.detalle.profesional, doctor.nombre)
})

test('con la fila vacia no se llama a nadie y no se inventa un apunte', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  const token = await tokenDe(doctor.id)
  const llamados = () => apuntes.filter((evento) => evento.tipo === 'TURNO_LLAMADO').length
  const antes = llamados()

  const respuesta = await consultorioLlamar.POST(peticion({ moduloId: modulo.id }), parametros({ token }))

  assert.equal(respuesta.status, 404)
  assert.equal(llamados(), antes, 'sin turno llamado no hay nada que registrar')
})

test('el llamado del operador queda a nombre de su cuenta, no del doctor', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  await pacienteEnEspera(doctor.id)

  const respuesta = await operadorLlamar.POST(peticion({ profesionalId: doctor.id, moduloId: modulo.id }))
  const { turno } = await respuesta.json()
  assert.equal(respuesta.status, 200)

  const apunte = ultimoApunte('TURNO_LLAMADO')
  assert.equal(apunte.usuarioId, sesion.user.id)
  assert.equal(apunte.usuarioNombre, sesion.user.name)
  assert.equal(apunte.identificador, turno.codigo)

  const repeticion = await operadorRepetir.POST(peticion(), parametros({ id: turno.id }))
  assert.equal(repeticion.status, 200)
  assert.equal(ultimoApunte('TURNO_REPETIDO').usuarioId, sesion.user.id)
})

// --- 4.2 La configuracion, que le mueve la agenda al hospital entero ---

/** Deja la configuracion como estaba: el resto de pruebas agenda contra ella. */
async function conConfiguracionRestaurada(prueba) {
  const original = await turnoRepository.configuracion()
  try {
    await prueba(original)
  } finally {
    await turnoRepository.guardarConfiguracion(original)
  }
}

test('cambiar el horario deja el antes y el despues, solo de lo que cambio', async () => {
  await conConfiguracionRestaurada(async (original) => {
    const respuesta = await rutaConfiguracion.PUT(
      new Request('http://localhost/api/turnos/configuracion', {
        method: 'PUT',
        // La pantalla manda SIEMPRE el objeto entero, como el cliente real.
        body: JSON.stringify({ ...original, jornadaMananaInicio: '06:30' }),
      }),
    )
    assert.equal(respuesta.status, 200)

    const apunte = ultimoApunte('CONFIGURACION_ACTUALIZADA')
    assert.equal(apunte.ip, '10.0.0.7')
    assert.deepEqual(apunte.detalle.cambios, {
      jornadaMananaInicio: { antes: original.jornadaMananaInicio, despues: '06:30' },
    })
  })
})

test('guardar sin tocar nada no apunta nueve cambios que no ocurrieron', async () => {
  await conConfiguracionRestaurada(async (original) => {
    await rutaConfiguracion.PUT(
      new Request('http://localhost/api/turnos/configuracion', {
        method: 'PUT',
        body: JSON.stringify(original),
      }),
    )

    assert.deepEqual(ultimoApunte('CONFIGURACION_ACTUALIZADA').detalle.cambios, {})
  })
})

test('un horario incoherente queda registrado como intento fallido', async () => {
  await conConfiguracionRestaurada(async (original) => {
    const respuesta = await rutaConfiguracion.PUT(
      new Request('http://localhost/api/turnos/configuracion', {
        method: 'PUT',
        // La tarde no puede empezar antes de que cierre la mañana.
        body: JSON.stringify({ ...original, jornadaTardeInicio: '09:00' }),
      }),
    )

    assert.equal(respuesta.status, 400)
    const apunte = ultimoApunte('CONFIGURACION_ACTUALIZADA')
    assert.equal(apunte.exito, false)
    assert.equal(apunte.usuarioId, sesion.user.id)
    assert.ok(apunte.detalle.motivo, 'tiene que decir por que se rechazo')
  })
})

test('una configuracion con formato invalido tambien deja rastro', async () => {
  const respuesta = await rutaConfiguracion.PUT(
    new Request('http://localhost/api/turnos/configuracion', {
      method: 'PUT',
      body: JSON.stringify({ jornadaMananaInicio: 'a las siete' }),
    }),
  )

  assert.equal(respuesta.status, 400)
  const apunte = ultimoApunte('CONFIGURACION_ACTUALIZADA')
  assert.equal(apunte.exito, false)
  assert.ok(apunte.detalle.motivo)
})

// --- 4.4 El doctor que cambia de consultorio ---

test('mover a un doctor de consultorio se registra con nombres, no con ids', async () => {
  const { doctor, modulo } = await doctorConConsultorio()
  const otro = await turnoRepository.crearModulo({
    nombre: 'Consultorio destino',
    servicioId: SERVICIO,
    activo: true,
  })

  const respuesta = await rutaProfesional.PATCH(
    new Request('http://localhost/api/turnos/profesionales', {
      method: 'PATCH',
      body: JSON.stringify({ moduloId: otro.id, jornada: 'TARDE' }),
    }),
    parametros({ id: doctor.id }),
  )
  assert.equal(respuesta.status, 200)

  const apunte = ultimoApunte('PROFESIONAL_ACTUALIZADO')
  assert.equal(apunte.identificador, doctor.nombre)
  assert.deepEqual(apunte.detalle.cambios.consultorio, { antes: modulo.nombre, despues: otro.nombre })
  assert.deepEqual(apunte.detalle.cambios.jornada, { antes: 'COMPLETA', despues: 'TARDE' })

  const escrito = JSON.stringify(apunte.detalle)
  assert.equal(escrito.includes(otro.id), false, 'un cuid no lo lee nadie')
  assert.equal(escrito.includes(modulo.id), false)
})

test('lo que no cambia del doctor no ensucia el registro', async () => {
  const { doctor } = await doctorConConsultorio()

  await rutaProfesional.PATCH(
    new Request('http://localhost/api/turnos/profesionales', {
      method: 'PATCH',
      body: JSON.stringify({ nombre: doctor.nombre, jornada: 'COMPLETA' }),
    }),
    parametros({ id: doctor.id }),
  )

  assert.deepEqual(ultimoApunte('PROFESIONAL_ACTUALIZADO').detalle.cambios, {})
})

// --- 4.5 Cuanto tiempo estuvo abierta esa llave ---

test('el enlace del consultorio se registra con su vigencia', async () => {
  const { doctor } = await doctorConConsultorio()

  const respuesta = await rutaAcceso.POST(
    new Request('http://localhost/api/profesionales/acceso', {
      method: 'POST',
      body: JSON.stringify({ horas: 2, minutos: 30 }),
    }),
    parametros({ id: doctor.id }),
  )
  const cuerpo = await respuesta.json()
  assert.equal(respuesta.status, 200)

  const apunte = ultimoApunte('ACCESO_PROFESIONAL_GENERADO')
  assert.equal(apunte.ip, '10.0.0.7')
  assert.equal(apunte.detalle.profesional, doctor.nombre)
  assert.equal(apunte.detalle.expiraEn, cuerpo.expiraEn)
  assert.equal(apunte.detalle.duracionMinutos, 150)
  assert.equal(JSON.stringify(apunte.detalle).includes(cuerpo.url), false, 'el token no se guarda nunca')
})

test('revocar el enlace deja cual se corto y hasta cuando valia', async () => {
  const { doctor } = await doctorConConsultorio()
  const { acceso } = await turnoRepository.crearAccesoProfesional(doctor.id, 60)

  const respuesta = await rutaRevocar.DELETE(
    new Request('http://localhost/api/profesionales/accesos', { method: 'DELETE' }),
    parametros({ id: acceso.id }),
  )
  assert.equal(respuesta.status, 200)

  const apunte = ultimoApunte('ACCESO_PROFESIONAL_REVOCADO')
  assert.equal(apunte.ip, '10.0.0.7')
  assert.equal(apunte.identificador, doctor.nombre)
  assert.equal(apunte.detalle.accesoId, acceso.id)
  assert.equal(apunte.detalle.expiraEn, acceso.expiraEn)
})

// El turno de ventanilla era la unica accion del sistema que cambiaba datos sin
// decir quien la hizo: la ruta exigia la sesion y la tiraba, y un turno sin cita
// no tiene a nadie detras en su propia fila. Si un paciente reclama que le
// dieron un numero que no era, tiene que haber a quien preguntarle.
test('entregar un turno de ventanilla deja quien lo entrego', async () => {
  const servicio = await turnoRepository.crearServicio({
    nombre: 'Facturacion rastro',
    prefijo: 'FR',
    modoFila: 'COMPARTIDA',
    activo: true,
  })

  const respuesta = await rutaVentanilla.POST(peticion({ servicioId: servicio.id }))
  assert.equal(respuesta.status, 200)
  const { turno } = await respuesta.json()

  const apunte = ultimoApunte('TURNO_GENERADO')
  assert.ok(apunte, 'entregar un turno de ventanilla tiene que dejar rastro')
  assert.equal(apunte.exito, true)
  assert.equal(apunte.usuarioId, sesion.user.id)
  assert.equal(apunte.usuarioNombre, sesion.user.name, 'el NOMBRE, no solo el id interno')
  assert.equal(apunte.identificador, turno.codigo, 'sobre que turno se actuo')
  assert.equal(apunte.ip, '10.0.0.7')

  // Y nada del paciente: un turno de ventanilla no tiene cita, pero el apunte
  // tampoco puede arrastrar datos por el detalle.
  const serializado = JSON.stringify(apunte)
  assert.equal(serializado.includes('documentoPaciente'), false)
  assert.equal(serializado.includes('nombrePaciente'), false)
})

test('un servicio que atiende por cita no entrega turnos de ventanilla ni deja rastro falso', async () => {
  const antes = apuntes.filter((e) => e.tipo === 'TURNO_GENERADO').length

  const respuesta = await rutaVentanilla.POST(peticion({ servicioId: SERVICIO }))

  assert.equal(respuesta.status, 400)
  assert.equal(
    apuntes.filter((e) => e.tipo === 'TURNO_GENERADO').length,
    antes,
    'una accion rechazada no puede apuntarse como hecha',
  )
})

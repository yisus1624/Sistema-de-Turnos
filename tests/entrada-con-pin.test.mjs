// Entrada de los medicos con PIN: el PIN solo dice quien es, cuatro fallos
// bloquean ese navegador cinco minutos, veinte desde una misma conexion la
// bloquean, y el administrador elige si se entra con PIN o con enlace.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

process.env.TURNOS_CLAVE_SECRETOS = process.env.TURNOS_CLAVE_SECRETOS || 'clave-de-pruebas-para-pin'

const { turnoRepository } = await import('./repositorios-en-memoria.mjs')

let sesion = null
let ipActual = null
mock.module('@/lib/auth', { namedExports: { auth: async () => sesion } })
mock.module('@/lib/seguridad/registro', {
  namedExports: {
    registrarEvento: async () => {},
    contextoPeticion: async () => ({ ip: ipActual, agente: 'pruebas' }),
    limitarIntentos: () => ({ permitido: true, reintentarEnSegundos: 0 }),
    limpiarIntentos: () => {},
    listarEventos: async () => [],
    tiposDeEvento: async () => [],
    confiarEnProxy: false,
  },
})

const { esPinFacil, esPinValido, sortearPin, DIGITOS_PIN } = await import('@/lib/turnos/reglas-pin')
const { COOKIE_NAVEGADOR, COOKIE_ENTRADA, FALLOS_POR_NAVEGADOR, FALLOS_POR_CONEXION } = await import('@/lib/consultorio/freno-pin')
const { minutosDeSesion } = await import('@/lib/consultorio/sesion-pin')
const { COOKIE_CONSULTORIO } = await import('@/lib/turnos/acceso-consultorio')
const { mundoDeDemostracion, PREFIJO_TOKEN_DEMOSTRACION } = await import('@/lib/demostracion/mundo')
const rutaPin = await import('@/app/api/medico/pin/route')
const rutaAcceso = await import('@/app/api/profesionales/[id]/acceso/route')

/** Pone el modo de entrada en la configuracion (con su marca, como la pantalla). */
async function modo(accesoProfesionales) {
  const actual = await turnoRepository.configuracion()
  await turnoRepository.guardarConfiguracion({ accesoProfesionales }, { visto: actual.actualizadoEn })
}

let navegadores = 0
/** Un navegador distinto en cada llamada salvo que se pase uno: el freno es por navegador. */
function navegador() {
  navegadores += 1
  return `navegador-de-prueba-${String(navegadores).padStart(4, '0')}`
}

function pedirPin(pin, idNavegador = navegador()) {
  return rutaPin.POST(
    new Request('http://localhost/api/medico/pin', {
      method: 'POST',
      headers: { cookie: `${COOKIE_NAVEGADOR}=${idNavegador}` },
      body: JSON.stringify({ pin }),
    }),
  )
}

const cookieDe = (respuesta, nombre) =>
  respuesta.headers.getSetCookie().find((linea) => linea.startsWith(`${nombre}=`))

// --- Las reglas del PIN -------------------------------------------------------------

test('el PIN es de 6 digitos, al azar y nunca de los faciles', () => {
  assert.equal(DIGITOS_PIN, 6)
  for (let i = 0; i < 500; i += 1) {
    const pin = sortearPin()
    assert.ok(esPinValido(pin), pin)
    assert.equal(esPinFacil(pin), false, pin)
  }
  for (const facil of ['000000', '111111', '123456', '654321', '234567']) assert.equal(esPinFacil(facil), true, facil)
  for (const malo of ['12345', '1234567', 'abcdef', '12 456', 123456]) assert.equal(esPinValido(malo), false, String(malo))
})

test('cada medico tiene un PIN distinto, y el PIN solo ya dice quien es', async () => {
  const [a, b] = await turnoRepository.listarProfesionales()
  const { pin: pinA } = await turnoRepository.asignarPin(a.id)
  const { pin: pinB } = await turnoRepository.asignarPin(b.id)
  assert.notEqual(pinA, pinB)
  assert.equal((await turnoRepository.profesionalPorPin(pinA)).id, a.id)
  assert.equal((await turnoRepository.profesionalPorPin(pinB)).id, b.id)
  assert.equal(await turnoRepository.profesionalPorPin('000001'), null)
})

test('cambiar el PIN deja sin servir el anterior; desactivarlo o eliminarlo, tambien', async () => {
  const medico = (await turnoRepository.listarProfesionales())[2]
  const { pin: viejo } = await turnoRepository.asignarPin(medico.id)
  const { pin: nuevo } = await turnoRepository.asignarPin(medico.id)
  assert.equal(await turnoRepository.profesionalPorPin(viejo === nuevo ? '000002' : viejo), null)
  assert.equal((await turnoRepository.profesionalPorPin(nuevo)).id, medico.id)

  await turnoRepository.cambiarEstadoPin(medico.id, false)
  assert.equal(await turnoRepository.profesionalPorPin(nuevo), null, 'desactivado no entra')
  await turnoRepository.cambiarEstadoPin(medico.id, true)
  assert.ok(await turnoRepository.profesionalPorPin(nuevo), 'activado vuelve a entrar')

  await turnoRepository.eliminarPin(medico.id)
  assert.equal(await turnoRepository.profesionalPorPin(nuevo), null, 'eliminado no entra')
  assert.ok(!(await turnoRepository.listarPines()).some((p) => p.profesionalId === medico.id))
})

test('el administrador puede volver a ver el PIN de cada medico', async () => {
  const medico = (await turnoRepository.listarProfesionales())[3]
  const { pin } = await turnoRepository.asignarPin(medico.id)
  const visto = (await turnoRepository.listarPines()).find((p) => p.profesionalId === medico.id)
  assert.equal(visto.pin, pin)
  assert.equal(visto.activo, true)
})

// --- La sesion del medico ----------------------------------------------------------

test('el medico queda dentro hasta el final de SU jornada, no treinta dias', () => {
  const horario = { jornadaMananaFin: '12:00', jornadaTardeFin: '17:00' }
  const a = (hora) => new Date(`2026-10-05T${hora}:00-05:00`)
  assert.equal(minutosDeSesion({ jornada: 'MANANA' }, horario, a('08:00')), 5 * 60, 'hasta las 13:00')
  assert.equal(minutosDeSesion({ jornada: 'TARDE' }, horario, a('13:00')), 5 * 60, 'hasta las 18:00')
  assert.equal(minutosDeSesion({ jornada: 'MANANA' }, horario, a('15:00')), 120, 'fuera de su jornada, dos horas')
})

// --- La ruta de entrada -------------------------------------------------------------

test('el PIN abre el consultorio de ese medico, lo saluda por su nombre y recuerda que es navegador de medico', async () => {
  await modo('PIN')
  const medico = (await turnoRepository.listarProfesionales())[1]
  const { pin } = await turnoRepository.asignarPin(medico.id)
  const respuesta = await pedirPin(pin)
  assert.equal(respuesta.status, 200)
  assert.ok(cookieDe(respuesta, COOKIE_ENTRADA), 'la app abrira directo el PIN la proxima vez')
  assert.equal((await respuesta.json()).nombre, medico.nombre)

  const cookie = cookieDe(respuesta, COOKIE_CONSULTORIO)
  assert.ok(cookie, 'deja la cookie del consultorio')
  assert.match(cookie, /Path=\/api\/consultorio/i)
  const token = decodeURIComponent(cookie.split(';')[0].split('=')[1])
  assert.equal((await turnoRepository.validarAccesoProfesional(token)).id, medico.id)
})

test(`a los ${FALLOS_POR_NAVEGADOR} PIN equivocados ese navegador se bloquea, aunque despues pongan el bueno`, async () => {
  await modo('PIN')
  const medico = (await turnoRepository.listarProfesionales())[4]
  const { pin } = await turnoRepository.asignarPin(medico.id)
  const este = navegador()

  const estados = []
  for (let i = 0; i < FALLOS_POR_NAVEGADOR; i += 1) estados.push((await pedirPin('999990', este)).status)
  assert.deepEqual(estados.slice(0, -1), Array(FALLOS_POR_NAVEGADOR - 1).fill(401))
  assert.equal(estados.at(-1), 429, 'el cuarto fallo ya avisa el bloqueo')
  assert.equal((await pedirPin(pin, este)).status, 429, 'bloqueado, ni con el PIN bueno')
  assert.equal((await pedirPin(pin)).status, 200, 'otro navegador (el consultorio de al lado) sigue entrando')
})

test(`a los ${FALLOS_POR_CONEXION} fallos desde una misma conexion se frena, aunque cambien de navegador`, async () => {
  await modo('PIN')
  const medico = (await turnoRepository.listarProfesionales())[5]
  const { pin } = await turnoRepository.asignarPin(medico.id)
  ipActual = '203.0.113.9'
  try {
    // Quien prueba desde fuera borra la cookie en cada intento: un navegador nuevo cada vez.
    for (let i = 0; i < FALLOS_POR_CONEXION; i += 1) await pedirPin('999991')
    assert.equal((await pedirPin(pin)).status, 429)
  } finally {
    ipActual = null
  }
  assert.equal((await pedirPin(pin)).status, 200, 'desde otra conexion se sigue entrando')
})

// --- El modo que elige el administrador ---------------------------------------------

test('con enlace el PIN queda apagado; con PIN no se generan enlaces nuevos', async () => {
  const medico = (await turnoRepository.listarProfesionales())[6]
  const { pin } = await turnoRepository.asignarPin(medico.id)
  sesion = { user: { id: 'u-admin', name: 'Admin', usuario: 'admin', rol: 'ADMINISTRADOR', area: null, secciones: null } }

  await modo('ENLACE')
  assert.equal((await pedirPin(pin)).status, 403)

  await modo('PIN')
  const generar = await rutaAcceso.POST(
    new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ horas: 8, minutos: 0 }) }),
    { params: Promise.resolve({ id: medico.id }) },
  )
  assert.equal(generar.status, 403)
  assert.equal((await pedirPin(pin)).status, 200)

  await modo('PIN')
  sesion = null
})

// --- La demostracion ----------------------------------------------------------------

test('los medicos de la demostracion ya traen PIN, y su acceso es del hospital de prueba', async () => {
  const { repositorio } = mundoDeDemostracion()
  const pines = await repositorio.listarPines()
  assert.equal(pines.length, (await repositorio.listarProfesionales()).length)
  const { pin, profesionalId } = pines[0]
  const medico = await repositorio.profesionalPorPin(pin)
  assert.equal(medico.id, profesionalId)
  const { token } = await repositorio.crearAccesoProfesional(medico.id, 60)
  assert.ok(token.startsWith(PREFIJO_TOKEN_DEMOSTRACION))
})

// La cuenta de demostracion trabaja sobre un hospital de mentira, APARTE.
//
// Lo que no puede pasar nunca: que una peticion del hospital real caiga en el
// de mentira (o al reves), que un llamado de prueba suene en un televisor de
// las salas, o que la demostracion escriba en la base. Estas pruebas fijan
// cada una de esas fronteras. Ver `lib/demostracion/mundo.ts`.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RAIZ = path.resolve(import.meta.dirname, '..')
const comoUrl = (relativa) => pathToFileURL(path.join(RAIZ, relativa)).href

// Lo que "llega" en cada peticion simulada: sus cabeceras y la sesion que
// resolveria Auth.js. Se cambian prueba a prueba.
let cabeceras = new Headers()
let sesion = null
let fallaLaSesion = false
let lecturasDeSesion = 0

mock.module(comoUrl('node_modules/next/headers.js'), {
  namedExports: {
    headers: async () => cabeceras,
    cookies: async () => ({ get: () => undefined, getAll: () => [] }),
    draftMode: async () => ({ isEnabled: false }),
  },
})
mock.module(comoUrl('lib/auth.ts'), {
  namedExports: {
    auth: async () => {
      lecturasDeSesion += 1
      if (fallaLaSesion) throw new Error('sesion ilegible')
      return sesion
    },
    handlers: {},
    signIn: async () => {},
    signOut: async () => {},
  },
})

const { enMundo, mundoActual, mundoDeDemostracion, MUNDO_REAL, PREFIJO_TOKEN_DEMOSTRACION, reiniciarDemostracion } =
  await import('@/lib/demostracion/mundo')
const { realtimeHub } = await import('@/lib/realtime/hub')
const { turnoRepository: enMemoriaPorDefecto } = await import('@/lib/turnos/in-memory-repository')
const { turnoRepository } = await import('@/lib/turnos/repositorio')
const { exigirCuentaReal } = await import('@/lib/permissions/session')

/** Una cookie de sesion distinta en cada prueba: la decision se recuerda por cookie. */
let numeroDeSesion = 0
function conCookieDeSesion() {
  numeroDeSesion += 1
  cabeceras = new Headers({ cookie: `authjs.session-token=sesion-${numeroDeSesion}` })
}

test.beforeEach(() => {
  cabeceras = new Headers()
  sesion = null
  fallaLaSesion = false
})

// --- Quien decide el mundo ---------------------------------------------------------

test('sin sesion (el televisor de la sala) es SIEMPRE el hospital real, y ni se lee la sesion', async () => {
  const antes = lecturasDeSesion
  assert.equal((await mundoActual()).demostracion, false)
  assert.equal(lecturasDeSesion, antes, 'sin cookie de sesion no se pregunta a la base')
})

test('una sesion normal es el hospital real', async () => {
  conCookieDeSesion()
  sesion = { user: { id: 'u1', rol: 'ADMINISTRADOR', demostracion: false } }
  assert.equal((await mundoActual()).demostracion, false)
})

test('la sesion de la cuenta de demostracion es el hospital de prueba', async () => {
  conCookieDeSesion()
  sesion = { user: { id: 'u-demo', rol: 'ADMINISTRADOR', demostracion: true } }
  const mundo = await mundoActual()
  assert.equal(mundo.demostracion, true)
  assert.notEqual(mundo.repositorio, MUNDO_REAL.repositorio)
})

test('si la sesion no se puede leer, es el hospital real: la duda nunca lleva a la demostracion', async () => {
  conCookieDeSesion()
  fallaLaSesion = true
  assert.equal((await mundoActual()).demostracion, false)
})

test('el consultorio entra sin sesion: su enlace de demostracion lo lleva al hospital de prueba', async () => {
  cabeceras = new Headers({ cookie: `turnos_consultorio=${PREFIJO_TOKEN_DEMOSTRACION}abc` })
  assert.equal((await mundoActual()).demostracion, true)
  cabeceras = new Headers({ 'x-consultorio-token': `${PREFIJO_TOKEN_DEMOSTRACION}abc` })
  assert.equal((await mundoActual()).demostracion, true)
  cabeceras = new Headers({ cookie: 'turnos_consultorio=token-real' })
  assert.equal((await mundoActual()).demostracion, false)
})

test('un mundo forzado manda sobre la sesion', async () => {
  conCookieDeSesion()
  sesion = { user: { id: 'u1', rol: 'ADMINISTRADOR', demostracion: false } }
  assert.equal((await enMundo(mundoDeDemostracion(), () => mundoActual())).demostracion, true)
})

test('la decision se recuerda por sesion: el repositorio no lee la sesion en cada llamada', async () => {
  conCookieDeSesion()
  sesion = { user: { id: 'u-demo', rol: 'ADMINISTRADOR', demostracion: true } }
  const antes = lecturasDeSesion
  for (let i = 0; i < 5; i += 1) await mundoActual()
  assert.equal(lecturasDeSesion - antes, 1)
})

// --- El hospital de prueba esta aparte ---------------------------------------------

test('el hospital de prueba tiene once doctores en la mañana y once en la tarde, inventados', async () => {
  const { repositorio } = mundoDeDemostracion()
  const doctores = await repositorio.listarProfesionales()
  assert.equal(doctores.filter((d) => d.jornada === 'MANANA').length, 11)
  assert.equal(doctores.filter((d) => d.jornada === 'TARDE').length, 11)
  assert.equal((await repositorio.listarModulos()).length, 11)
})

test('lo que se crea en la demostracion no aparece en el otro mundo, ni al reves', async () => {
  const { repositorio } = mundoDeDemostracion()
  const servicio = (await repositorio.listarServicios())[0]
  await repositorio.crearModulo({ nombre: 'Consultorio de la demo 99', servicioId: servicio.id, activo: true })

  const enElOtro = await enMemoriaPorDefecto.listarModulos(undefined, true)
  assert.ok(!enElOtro.some((m) => m.nombre === 'Consultorio de la demo 99'))

  await enMemoriaPorDefecto.crearModulo({ nombre: 'Consultorio solo del otro 98', servicioId: servicio.id, activo: true })
  assert.ok(!(await repositorio.listarModulos(undefined, true)).some((m) => m.nombre === 'Consultorio solo del otro 98'))
})

test('un llamado de la demostracion suena en SU canal, nunca en el de las salas reales', async () => {
  const demostracion = mundoDeDemostracion()
  const { repositorio, hub } = demostracion
  const doctor = (await repositorio.listarProfesionales())[0]
  const cita = (await repositorio.listarCitas({ profesionalId: doctor.id })).find((c) => c.estado === 'PROGRAMADA')
  await repositorio.registrarLlegada(cita.id)

  const enLasSalas = []
  const enLaDemo = []
  const soltarSalas = realtimeHub.subscribe((evento) => enLasSalas.push(evento))
  const soltarDemo = hub.subscribe((evento) => enLaDemo.push(evento))
  try {
    await repositorio.llamarSiguiente({
      profesionalId: doctor.id,
      moduloId: doctor.moduloId,
      funcionarioId: 'u-demo',
      turnoAbiertoEsperado: null,
    })
  } finally {
    soltarSalas()
    soltarDemo()
  }
  assert.ok(enLaDemo.some((e) => e.tipo === 'turno.llamado'))
  assert.deepEqual(enLasSalas, [], 'ni un evento de la demo en el canal real')
})

test('los enlaces de doctor de la demostracion llevan su prefijo; los otros no', async () => {
  const { repositorio } = mundoDeDemostracion()
  const doctor = (await repositorio.listarProfesionales())[0]
  const { token } = await repositorio.crearAccesoProfesional(doctor.id, 60)
  assert.ok(token.startsWith(PREFIJO_TOKEN_DEMOSTRACION))

  const otro = (await enMemoriaPorDefecto.listarProfesionales())[0]
  const { token: normal } = await enMemoriaPorDefecto.crearAccesoProfesional(otro.id, 60)
  assert.ok(!normal.startsWith(PREFIJO_TOKEN_DEMOSTRACION))
})

test('el repositorio de todo el sistema obedece al mundo de la peticion', async () => {
  conCookieDeSesion()
  sesion = { user: { id: 'u-demo', rol: 'ADMINISTRADOR', demostracion: true } }
  const doctores = await turnoRepository.listarProfesionales()
  assert.ok(doctores.length >= 22)
  assert.ok(doctores.every((d) => d.id.startsWith('pro-demo-')))
})

test('reiniciar la demostracion la deja como nueva y avisa a sus pantallas', async () => {
  const antes = mundoDeDemostracion()
  const servicio = (await antes.repositorio.listarServicios())[0]
  await antes.repositorio.crearModulo({ nombre: 'Se borra al reiniciar', servicioId: servicio.id, activo: true })

  const avisos = []
  const soltar = antes.hub.subscribe((evento) => avisos.push(evento))
  reiniciarDemostracion()
  soltar()

  const despues = mundoDeDemostracion()
  assert.equal(despues.hub, antes.hub, 'las pantallas abiertas siguen en el mismo canal')
  assert.ok(!(await despues.repositorio.listarModulos(undefined, true)).some((m) => m.nombre === 'Se borra al reiniciar'))
  assert.ok(avisos.some((e) => e.tipo === 'datos.reiniciados'))
})

// --- Lo que escribe directo en la base, cerrado ------------------------------------

test('lo que escribe directo en la base real le responde 403 a la cuenta de demostracion', () => {
  assert.throws(() => exigirCuentaReal({ user: { demostracion: true } }), (error) => error.status === 403)
  assert.doesNotThrow(() => exigirCuentaReal({ user: { demostracion: false } }))
  assert.doesNotThrow(() => exigirCuentaReal({ user: {} }))
})

// --- Lo que rompia la simulacion y lo que se ve con la cartelera de nombres ----------

test('el consultorio acepta el enlace de un doctor de la demostracion (prefijo + 43)', async () => {
  // El enlace de la demo mide 48: el formato exigia 43 exactos y lo rechazaba
  // como mal formado, asi que "Siguiente paciente" de la simulacion daba 401.
  const { repositorio } = mundoDeDemostracion()
  const doctor = (await repositorio.listarProfesionales())[1]
  const { token } = await repositorio.crearAccesoProfesional(doctor.id, 60)
  const { requireProfesionalPorToken } = await import('@/lib/turnos/acceso-consultorio')
  cabeceras = new Headers({ 'x-consultorio-token': token })
  const entro = await requireProfesionalPorToken(token)
  assert.equal(entro.id, doctor.id)
})

test('con la cartelera de nombres el paciente se nombra abreviado, sin codigo', async () => {
  const { nombreAbreviado, seNombraAlPaciente } = await import('@/lib/turnos/nombre-abreviado')
  assert.equal(nombreAbreviado('Juan Carlos Perez Gomez'), 'Juan C. P. G.')
  assert.equal(nombreAbreviado('  maria   lopez '), 'maria L.')
  assert.equal(nombreAbreviado(null), 'Paciente')
  assert.equal(seNombraAlPaciente('CARTELERA_PACIENTE'), true)
  assert.equal(seNombraAlPaciente('CARTELERA'), false)
})

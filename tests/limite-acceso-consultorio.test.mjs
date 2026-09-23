// El enlace del doctor NO puede bloquearse por usarlo.
//
// El limite de intentos contaba PETICIONES, no fallos: 30 en cinco minutos y
// el enlace dejaba de responder. La pantalla del consultorio se recarga con
// cada evento del hospital, asi que en hora pico ese tope se pasa solo. Al
// medico le salia "El enlace no es valido o ya vencio" con el enlace bueno en
// la mano y pacientes esperando, y el registro se llenaba de accesos fallidos
// que no eran ataques.
//
// Y como defensa contra la fuerza bruta tampoco servia: la clave del contador
// era el propio token, asi que quien prueba tokens al azar estrena contador en
// cada intento. Lo que si acota una avalancha es el origen, y solo cuando la IP
// es de fiar (ver `contextoPeticion`).
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

// ANTES QUE NADA: sin esto las pruebas escriben en la base real del hospital.
const { turnoRepository } = await import('./repositorios-en-memoria.mjs')

// El limitador va DE VERDAD: es justo lo que se esta probando. Lo unico que se
// sustituye es la escritura del registro (que es Prisma) y la IP de la
// peticion, que en las pruebas no hay cabeceras de donde sacarla.
const { limitarIntentos, limpiarIntentos } = await import('@/lib/seguridad/registro')

const apuntes = []
let ipDeLaPeticion = null

mock.module('@/lib/seguridad/registro', {
  namedExports: {
    limitarIntentos,
    limpiarIntentos,
    registrarEvento: async (evento) => {
      apuntes.push(evento)
    },
    contextoPeticion: async () => ({ ip: ipDeLaPeticion, agente: 'pruebas' }),
    listarEventos: async () => [],
    tiposDeEvento: async () => [],
    confiarEnProxy: false,
  },
})

const { requireProfesionalPorToken } = await import('@/lib/turnos/acceso-consultorio')

/**
 * Un token inventado CON el formato real (43 caracteres base64url): los que no
 * lo tienen se rechazan antes del limitador (ver la prueba del formato).
 */
function inventado(nombre, n = 0) {
  return `${String(n).padStart(6, '0')}${nombre.replace(/[^A-Za-z0-9_-]/g, '')}${'x'.repeat(43)}`.slice(0, 43)
}

/** El motivo del ultimo rechazo que quedo apuntado. */
function ultimoMotivo() {
  return apuntes.at(-1)?.detalle?.motivo
}

test('el enlace bueno aguanta una jornada entera de peticiones', async () => {
  const { token } = await turnoRepository.crearAccesoProfesional('pro-perez', 60)

  // Muy por encima de las 30 que antes lo tumbaban: la pantalla del doctor
  // recarga con cada evento del hospital, y en hora pico son mas que estas.
  for (let peticion = 1; peticion <= 90; peticion += 1) {
    const profesional = await requireProfesionalPorToken(token)
    assert.equal(
      profesional.id,
      'pro-perez',
      `la peticion ${peticion} del mismo enlace bueno no puede rechazarse`,
    )
  }
})

test('un enlace inventado se rechaza siempre, se pruebe una vez o cien', async () => {
  ipDeLaPeticion = null

  await assert.rejects(
    () => requireProfesionalPorToken(inventado('jamas-se-genero')),
    /no es valido o ya vencio/i,
  )
  assert.equal(ultimoMotivo(), 'token_invalido')
})

test('sin proxy declarado no se bloquea por origen: la IP no es de fiar', async () => {
  // `contextoPeticion` devuelve null cuando no hay proxy: la cabecera la pone
  // quien quiera, asi que bloquear por ella no protege de nada y si podria
  // dejar fuera a medio hospital.
  ipDeLaPeticion = null

  for (let intento = 1; intento <= 60; intento += 1) {
    await assert.rejects(() => requireProfesionalPorToken(inventado('sin-ip', intento)))
  }

  assert.equal(
    ultimoMotivo(),
    'token_invalido',
    'sin IP de fiar, el rechazo sigue siendo por el token, no por el origen',
  )
})

test('con proxy declarado, la avalancha de tokens inventados desde un mismo origen se corta', async () => {
  ipDeLaPeticion = '198.51.100.7'

  // Por encima del tope por IP (500 en 5 minutos): una avalancha, no una oficina.
  const motivos = []
  for (let intento = 1; intento <= 520; intento += 1) {
    await assert.rejects(() => requireProfesionalPorToken(inventado('con-ip', intento)))
    motivos.push(ultimoMotivo())
  }

  assert.ok(
    motivos.includes('demasiados_intentos_ip'),
    'probar tokens al azar desde una misma IP tiene que acabar cortandose',
  )
  assert.equal(
    motivos[0],
    'token_invalido',
    'los primeros intentos no se cortan: pueden ser un enlace vencido de verdad',
  )
})

test('al doctor legitimo no le afecta lo que haga otro origen', async () => {
  // La IP que acaba de agotar su cupo en la prueba anterior sigue bloqueada;
  // el enlace bueno, desde otra red, tiene que seguir entrando.
  ipDeLaPeticion = '203.0.113.20'
  const { token } = await turnoRepository.crearAccesoProfesional('pro-gomez', 60)

  const profesional = await requireProfesionalPorToken(token)
  assert.equal(profesional.id, 'pro-gomez')
})

test('desde la IP del hospital, los enlaces vencidos de otros consultorios no bloquean al doctor', async () => {
  // Todo el hospital sale por la misma IP. Varias pestañas con enlaces vencidos
  // recargando en otros consultorios no pueden agotar el cupo de todos: el
  // tope por IP es un freno contra avalanchas, muy por encima de eso.
  ipDeLaPeticion = '181.52.13.77'

  for (let intento = 1; intento <= 120; intento += 1) {
    await assert.rejects(() => requireProfesionalPorToken(inventado('vencido', intento)))
  }
  assert.equal(ultimoMotivo(), 'token_invalido', 'una oficina normal no alcanza el tope por IP')

  const { token } = await turnoRepository.crearAccesoProfesional('pro-perez', 60)
  const profesional = await requireProfesionalPorToken(token)
  assert.equal(profesional.id, 'pro-perez')
})

test('un token sin el formato real se rechaza antes del limitador y sin consultar la base', async () => {
  // Llega de la cookie o de una cabecera, y lo escribe quien quiera: uno de un
  // mega ya no llega ni al limitador ni al hash de la base.
  ipDeLaPeticion = '198.51.100.77'
  for (const malo of ['corto', 'x'.repeat(44), 'x'.repeat(42) + '!', 'x'.repeat(1_000_000)]) {
    await assert.rejects(() => requireProfesionalPorToken(malo), /no es valido o ya vencio/i)
    assert.equal(ultimoMotivo(), 'token_malformado')
  }
})

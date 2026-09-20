// Cambiar las credenciales de una cuenta SIN PERDER EL RASTRO.
//
// Las tres cosas que se comprueban aqui son las que hacen que el registro de
// actividad siga contestando "quien hizo que" despues de un cambio de
// credenciales:
//
//   1. Renombrar EDITA la cuenta, no la sustituye: el id se queda, y con el
//      todo el historico de turnos y de eventos que lo referencia.
//   2. El renombrado deja escrito el nombre ANTERIOR y el NUEVO. Sin eso, un
//      evento firmado como "func6" se vuelve imposible de atribuir el dia que
//      esa cuenta pasa a llamarse de otra forma.
//   3. LA CONTRASEÑA NO APARECE EN EL REGISTRO. Ni la vieja, ni la nueva, ni
//      en un intento fallido.
//
// Se montan los route handlers de verdad, con el repositorio en memoria y la
// sesion inyectada.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

// ANTES QUE NADA, y antes de cualquier route handler: sin esto las pruebas
// escriben en la base de datos REAL del hospital.
const { usuarioRepository } = await import('./repositorios-en-memoria.mjs')

/** Lo que se fue apuntando en el registro durante la prueba. */
const apuntes = []

/** La sesion que devuelve `auth()`. Se cambia por prueba. */
let sesionActual = null

/** Si el limitador deja pasar. Lo cambia la prueba que lo comprueba. */
let limitePermitido = true

mock.module('@/lib/auth', { namedExports: { auth: async () => sesionActual } })

// El registro se sustituye entero: escribe en la base con Prisma, y lo que hay
// que comprobar aqui es lo que las rutas le entregan.
mock.module('@/lib/seguridad/registro', {
  namedExports: {
    registrarEvento: async (evento) => {
      apuntes.push(evento)
    },
    contextoPeticion: async () => ({ ip: '10.0.0.7', agente: 'pruebas' }),
    limitarIntentos: () => ({ permitido: limitePermitido, reintentarEnSegundos: 300 }),
    limpiarIntentos: () => {},
    listarEventos: async () => [],
    tiposDeEvento: async () => [],
    confiarEnProxy: false,
  },
})

mock.module('next/headers', { namedExports: { headers: async () => new Headers() } })

const rutaUsuario = await import('@/app/api/usuarios/[id]/route')
const rutaContrasenaPropia = await import('@/app/api/cuenta/contrasena/route')
const { EVENTOS } = await import('@/lib/seguridad/eventos')

function sesionDe(usuario) {
  return {
    user: {
      id: usuario.id,
      name: usuario.nombre,
      usuario: usuario.usuario,
      rol: usuario.rol,
      area: usuario.area,
      secciones: usuario.secciones ?? null,
    },
  }
}

function peticion(cuerpo) {
  return new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(cuerpo) })
}

const parametros = (id) => ({ params: Promise.resolve({ id }) })

let creadas = 0
async function crearCuenta({ rol = 'OPERADOR', secciones = null, password = 'claveinicial123' } = {}) {
  creadas += 1
  return usuarioRepository.crear({
    nombre: `Funcionario ${creadas}`,
    usuario: `cuenta${creadas}`,
    rol,
    area: null,
    password,
    secciones,
  })
}

/** Arranca una prueba con el registro y el limitador limpios. */
function empezar() {
  apuntes.length = 0
  limitePermitido = true
}

/** Si alguna de las cadenas aparece en cualquier parte de lo apuntado. */
function apareceEnElRegistro(...secretos) {
  const escrito = JSON.stringify(apuntes)
  return secretos.some((secreto) => escrito.includes(secreto))
}

const apuntesDe = (tipo) => apuntes.filter((apunte) => apunte.tipo === tipo)

// --- 1. Renombrar conserva la cuenta y su historico ---

test('renombrar una cuenta conserva su id y su historico', async () => {
  empezar()
  const admin = await crearCuenta({ rol: 'ADMINISTRADOR' })
  const objetivo = await crearCuenta()
  sesionActual = sesionDe(admin)

  const nombreAnterior = objetivo.usuario
  const respuesta = await rutaUsuario.PATCH(
    peticion({ usuario: 'mgomez.nuevo' }),
    parametros(objetivo.id),
  )

  assert.equal(respuesta.status, 200)
  const { usuario } = await respuesta.json()

  // EL ID NO CAMBIA. Es lo que sostiene el historico: los turnos y los eventos
  // ya escritos apuntan a el.
  assert.equal(usuario.id, objetivo.id)
  assert.equal(usuario.usuario, 'mgomez.nuevo')

  // Y entra con el nombre nuevo, no con el viejo.
  assert.ok(await usuarioRepository.verificarCredenciales('mgomez.nuevo', 'claveinicial123'))
  assert.equal(await usuarioRepository.verificarCredenciales(nombreAnterior, 'claveinicial123'), null)
})

test('el renombrado deja escrito el nombre anterior y el nuevo', async () => {
  empezar()
  const admin = await crearCuenta({ rol: 'ADMINISTRADOR' })
  const objetivo = await crearCuenta()
  sesionActual = sesionDe(admin)

  const anterior = objetivo.usuario
  await rutaUsuario.PATCH(peticion({ usuario: 'renombrada.uno' }), parametros(objetivo.id))

  const [apunte] = apuntesDe(EVENTOS.USUARIO_RENOMBRADO)
  assert.ok(apunte, 'no quedo apuntado el renombrado')
  assert.equal(apunte.exito, true)
  assert.equal(apunte.usuarioId, admin.id)
  assert.deepEqual(apunte.detalle.usuario, { antes: anterior, despues: 'renombrada.uno' })
  assert.equal(apunte.detalle.objetivoId, objetivo.id)
})

test('un nombre de usuario ya tomado se rechaza y queda apuntado', async () => {
  empezar()
  const admin = await crearCuenta({ rol: 'ADMINISTRADOR' })
  const ocupada = await crearCuenta()
  const objetivo = await crearCuenta()
  sesionActual = sesionDe(admin)

  const respuesta = await rutaUsuario.PATCH(
    peticion({ usuario: ocupada.usuario }),
    parametros(objetivo.id),
  )

  assert.equal(respuesta.status, 400)
  const { error } = await respuesta.json()
  assert.match(error, /ya existe/i)

  const fallido = apuntesDe(EVENTOS.USUARIO_RENOMBRADO).find((apunte) => apunte.exito === false)
  assert.ok(fallido, 'el intento rechazado no quedo apuntado')

  // Y la cuenta se quedo como estaba.
  const despues = (await usuarioRepository.listar()).find((u) => u.id === objetivo.id)
  assert.equal(despues.usuario, objetivo.usuario)
})

// --- 2. Cada quien cambia su propia contraseña, con la actual ---

test('el cambio propio exige la contrasena actual', async () => {
  empezar()
  const cuenta = await crearCuenta({ password: 'laquetenia123' })
  sesionActual = sesionDe(cuenta)

  const respuesta = await rutaContrasenaPropia.POST(
    peticion({ actual: 'laquenoera123', nueva: 'lanuevaclave123' }),
  )

  assert.equal(respuesta.status, 400)
  // La clave sigue siendo la de antes: no se escribio nada.
  assert.ok(await usuarioRepository.verificarCredenciales(cuenta.usuario, 'laquetenia123'))
  assert.equal(await usuarioRepository.verificarCredenciales(cuenta.usuario, 'lanuevaclave123'), null)

  const fallido = apuntesDe(EVENTOS.USUARIO_CONTRASENA_CAMBIADA).find((a) => a.exito === false)
  assert.ok(fallido, 'el intento con la clave equivocada no quedo apuntado')
})

test('con la contrasena actual correcta el funcionario cambia la suya', async () => {
  empezar()
  const cuenta = await crearCuenta({ password: 'laquetenia123' })
  sesionActual = sesionDe(cuenta)

  const respuesta = await rutaContrasenaPropia.POST(
    peticion({ actual: 'laquetenia123', nueva: 'lanuevaclave123' }),
  )

  assert.equal(respuesta.status, 200)
  assert.ok(await usuarioRepository.verificarCredenciales(cuenta.usuario, 'lanuevaclave123'))
  assert.equal(await usuarioRepository.verificarCredenciales(cuenta.usuario, 'laquetenia123'), null)

  const apunte = apuntesDe(EVENTOS.USUARIO_CONTRASENA_CAMBIADA).find((a) => a.exito)
  assert.ok(apunte)
  assert.equal(apunte.usuarioId, cuenta.id)
})

test('sin sesion no se cambia la contrasena de nadie', async () => {
  empezar()
  sesionActual = null

  const respuesta = await rutaContrasenaPropia.POST(
    peticion({ actual: 'loquesea123', nueva: 'lanuevaclave123' }),
  )

  assert.equal(respuesta.status, 401)
})

test('el formulario de cambio propio no sirve para adivinar la clave a fuerza bruta', async () => {
  empezar()
  const cuenta = await crearCuenta({ password: 'laquetenia123' })
  sesionActual = sesionDe(cuenta)
  limitePermitido = false

  const respuesta = await rutaContrasenaPropia.POST(
    peticion({ actual: 'laquetenia123', nueva: 'lanuevaclave123' }),
  )

  assert.equal(respuesta.status, 429)
  // Ni siquiera con la correcta: el limite corta antes de comprobar nada.
  assert.ok(await usuarioRepository.verificarCredenciales(cuenta.usuario, 'laquetenia123'))
})

test('la contrasena nueva tiene minimo ocho caracteres', async () => {
  empezar()
  const cuenta = await crearCuenta({ password: 'laquetenia123' })
  sesionActual = sesionDe(cuenta)

  const respuesta = await rutaContrasenaPropia.POST(peticion({ actual: 'laquetenia123', nueva: 'corta' }))

  assert.equal(respuesta.status, 400)
})

// --- 3. La contraseña nunca llega al registro ---

test('ninguna contrasena aparece en el registro, ni al cambiarla uno mismo ni al restablecerla', async () => {
  empezar()
  const cuenta = await crearCuenta({ password: 'laquetenia123' })
  sesionActual = sesionDe(cuenta)
  await rutaContrasenaPropia.POST(peticion({ actual: 'laquetenia123', nueva: 'lanuevaclave123' }))
  await rutaContrasenaPropia.POST(peticion({ actual: 'noeraesta123', nueva: 'otraquenoentra123' }))

  const admin = await crearCuenta({ rol: 'ADMINISTRADOR' })
  const otro = await crearCuenta()
  sesionActual = sesionDe(admin)
  await rutaUsuario.PATCH(peticion({ password: 'restablecida123' }), parametros(otro.id))

  assert.ok(apuntes.length > 0, 'no se apunto nada: la prueba no estaria comprobando nada')
  assert.equal(
    apareceEnElRegistro(
      'laquetenia123',
      'lanuevaclave123',
      'noeraesta123',
      'otraquenoentra123',
      'restablecida123',
    ),
    false,
    'una contrasena acabo escrita en el registro de actividad',
  )

  // Pero SI queda escrito que se cambio: es el dato que hay que poder revisar.
  assert.ok(apuntesDe(EVENTOS.USUARIO_CONTRASENA_CAMBIADA).length >= 2)
})

// --- 4. Las cuentas semilla se administran como cualquier otra ---

test('la cuenta del administrador se puede renombrar a si misma sin perder la sesion', async () => {
  empezar()
  const admin = await crearCuenta({ rol: 'ADMINISTRADOR' })
  sesionActual = sesionDe(admin)

  const respuesta = await rutaUsuario.PATCH(peticion({ usuario: 'jefatura.sistemas' }), parametros(admin.id))

  assert.equal(respuesta.status, 200)
  const { usuario } = await respuesta.json()
  // El id es lo que lleva la sesion (el `sub` del token), asi que renombrarse
  // no echa a nadie de su propia sesion.
  assert.equal(usuario.id, admin.id)
  assert.equal(usuario.usuario, 'jefatura.sistemas')
})

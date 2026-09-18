// Las RUTAS de usuarios aplican la politica de permisos, no solo la conocen.
//
// `escalada-permisos.test.mjs` prueba la politica pura, que es donde viven las
// reglas. Esto prueba otra cosa distinta y que tambien hace falta: que las dos
// rutas de la API la LLAMEN. Si mañana alguien añade un endpoint de usuarios, o
// reordena el codigo y el veredicto deja de aplicarse antes de escribir, la
// politica seguiria siendo correcta y el sistema estaria abierto igual.
//
// Se montan los route handlers de verdad, con el repositorio en memoria y la
// sesion inyectada.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

// ANTES QUE NADA, y antes de cualquier route handler: sin esto las pruebas
// escriben en la base de datos REAL del hospital, porque el selector de
// repositorio apunta a PostgreSQL.
const { usuarioRepository } = await import('./repositorios-en-memoria.mjs')

/** La sesion que devuelve `auth()` en cada caso. Se cambia por prueba. */
let sesionActual = null

mock.module('@/lib/auth', { namedExports: { auth: async () => sesionActual } })

// `contextoPeticion` lee las cabeceras para sacar la IP, y `next/headers` solo
// funciona dentro de una peticion de verdad. Aqui se llama al manejador
// directamente, asi que se le da un juego de cabeceras vacio.
mock.module('next/headers', {
  namedExports: { headers: async () => new Headers() },
})

const rutaLista = await import('@/app/api/usuarios/route')
const rutaUno = await import('@/app/api/usuarios/[id]/route')

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
  return new Request('http://localhost/api/usuarios', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  })
}

const parametros = (id) => ({ params: Promise.resolve({ id }) })

/** Cuentas nuevas en cada prueba, para no heredar estado. */
let creadas = 0
async function crearCuenta({ rol = 'OPERADOR', secciones = null } = {}) {
  creadas += 1
  return usuarioRepository.crear({
    nombre: `Funcionario ${creadas}`,
    usuario: `func${creadas}`,
    rol,
    area: null,
    password: 'claveinicial123',
    secciones,
  })
}

test('la ruta rechaza que un operador tome la cuenta de otro con mas accesos', async () => {
  const encargado = await crearCuenta({ secciones: ['/admin/usuarios'] })
  const conMasAcceso = await crearCuenta({ secciones: ['/admin/citas', '/admin/seguridad'] })
  sesionActual = sesionDe(encargado)

  const respuesta = await rutaUno.PATCH(
    peticion({ password: 'claverobada123' }),
    parametros(conMasAcceso.id),
  )

  assert.equal(respuesta.status, 403)

  // Y la clave de la victima sigue siendo la suya: no se escribio nada.
  assert.ok(await usuarioRepository.verificarCredenciales(conMasAcceso.usuario, 'claveinicial123'))
  assert.equal(
    await usuarioRepository.verificarCredenciales(conMasAcceso.usuario, 'claverobada123'),
    null,
  )
})

test('la ruta rechaza colar las secciones del rol con secciones nulas', async () => {
  const encargado = await crearCuenta({ secciones: ['/admin/usuarios'] })
  sesionActual = sesionDe(encargado)

  creadas += 1
  const respuesta = await rutaLista.POST(
    peticion({
      nombre: 'Cuenta Colada',
      usuario: `colada${creadas}`,
      rol: 'OPERADOR',
      password: 'claveinicial123',
      secciones: null,
    }),
  )

  assert.equal(respuesta.status, 403)
})

test('la ruta rechaza dejar a un operador sin ninguna seccion', async () => {
  const admin = await crearCuenta({ rol: 'ADMINISTRADOR' })
  const operador = await crearCuenta({ secciones: ['/admin/citas'] })
  sesionActual = sesionDe(admin)

  const respuesta = await rutaUno.PATCH(peticion({ secciones: [] }), parametros(operador.id))

  assert.equal(respuesta.status, 400)

  // La cuenta se quedo como estaba, no a medias.
  const despues = (await usuarioRepository.listar()).find((u) => u.id === operador.id)
  assert.deepEqual(despues.secciones, ['/admin/citas'])
})

test('la ruta rechaza secciones que no existen en el catalogo', async () => {
  const admin = await crearCuenta({ rol: 'ADMINISTRADOR' })
  const operador = await crearCuenta({ secciones: ['/admin/citas'] })
  sesionActual = sesionDe(admin)

  const respuesta = await rutaUno.PATCH(
    peticion({ secciones: ['/admin/no-existe'] }),
    parametros(operador.id),
  )

  assert.equal(respuesta.status, 400)
})

test('el administrador sigue pudiendo restablecer la contrasena de cualquiera', async () => {
  // La comprobacion importa tanto como los rechazos: una regla de seguridad que
  // ademas bloquea el trabajo legitimo acaba desactivada por quien la sufre.
  const admin = await crearCuenta({ rol: 'ADMINISTRADOR' })
  const otro = await crearCuenta({ secciones: ['/admin/citas', '/admin/seguridad'] })
  sesionActual = sesionDe(admin)

  const respuesta = await rutaUno.PATCH(
    peticion({ password: 'claverestablecida1' }),
    parametros(otro.id),
  )

  assert.equal(respuesta.status, 200)
  assert.ok(await usuarioRepository.verificarCredenciales(otro.usuario, 'claverestablecida1'))
})

test('el encargado de cuentas sigue administrando las que estan a su alcance', async () => {
  const encargado = await crearCuenta({ secciones: ['/admin/usuarios'] })
  const delMostrador = await crearCuenta({ secciones: ['/admin/usuarios'] })
  sesionActual = sesionDe(encargado)

  const respuesta = await rutaUno.PATCH(
    peticion({ password: 'claveolvidada123' }),
    parametros(delMostrador.id),
  )

  assert.equal(respuesta.status, 200)
})

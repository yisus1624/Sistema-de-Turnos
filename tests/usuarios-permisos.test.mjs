// Permisos guardados en la cuenta del funcionario (requerimiento seccion 16).
//
// Lo que se cuida aqui es el recorrido completo del permiso: el administrador
// le marca secciones a un operador y esas secciones tienen que seguir ahi
// cuando el operador vuelve a entrar, porque de ahi salen su menu y los guardas
// de las pantallas (ver `lib/permissions/rutas.ts`).
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryUsuarioRepository } = await import('@/lib/usuarios/in-memory-repository')
const { puedeVerSeccion } = await import('@/lib/permissions/rutas')
const { rutaInicialPorRol } = await import('@/lib/auth-routing')

const repo = new InMemoryUsuarioRepository()

async function operadorNuevo(usuario, secciones) {
  return repo.crear({
    nombre: 'Funcionario de prueba',
    usuario,
    rol: 'OPERADOR',
    area: 'Facturacion',
    password: 'clave12345',
    secciones,
  })
}

test('un operador sin lista explicita se guarda con secciones nulas (las de su rol)', async () => {
  const creado = await operadorNuevo('op.pordefecto')
  assert.equal(creado.secciones, null)

  const leido = await repo.buscarPorId(creado.id)
  assert.equal(puedeVerSeccion(leido.rol, leido.secciones, '/operador/agenda'), true)
  assert.equal(puedeVerSeccion(leido.rol, leido.secciones, '/admin/servicios'), false)
})

test('las secciones de administracion que se le dan a un operador se conservan', async () => {
  const creado = await operadorNuevo('op.conservicios', ['/operador', '/admin/servicios'])

  // Se relee, que es lo que hace la sesion en cada peticion.
  const leido = await repo.buscarPorId(creado.id)
  assert.deepEqual(leido.secciones, ['/operador', '/admin/servicios'])
  assert.equal(puedeVerSeccion(leido.rol, leido.secciones, '/admin/servicios'), true)
  assert.equal(puedeVerSeccion(leido.rol, leido.secciones, '/admin/usuarios'), false)
})

test('editar los permisos de un operador se refleja de inmediato al releer la cuenta', async () => {
  const creado = await operadorNuevo('op.editado', ['/operador'])

  await repo.actualizar(creado.id, { secciones: ['/operador', '/admin/citas'] })

  const leido = await repo.buscarPorId(creado.id)
  assert.deepEqual(leido.secciones, ['/operador', '/admin/citas'])
  assert.equal(puedeVerSeccion(leido.rol, leido.secciones, '/admin/citas'), true)
})

test('quitarle una seccion a un operador se la quita de verdad', async () => {
  const creado = await operadorNuevo('op.recortado', ['/operador', '/admin/citas'])

  await repo.actualizar(creado.id, { secciones: ['/operador'] })

  const leido = await repo.buscarPorId(creado.id)
  assert.equal(puedeVerSeccion(leido.rol, leido.secciones, '/admin/citas'), false)
})

test('devolverle el acceso completo de su rol se guarda como null, no como lista vacia', async () => {
  const creado = await operadorNuevo('op.devuelto', ['/operador'])

  await repo.actualizar(creado.id, { secciones: null })

  const leido = await repo.buscarPorId(creado.id)
  assert.equal(leido.secciones, null)
  assert.equal(puedeVerSeccion(leido.rol, leido.secciones, '/operador/agenda'), true)
})

test('un administrador siempre ve todo: la lista de secciones se ignora', async () => {
  const admin = await repo.crear({
    nombre: 'Jefe de sistemas',
    usuario: 'admin.pruebas',
    rol: 'ADMINISTRADOR',
    area: 'Sistemas',
    password: 'clave12345',
    secciones: ['/operador'],
  })

  // La lista se ignora YA AL CREARLO, no solo al editarlo despues. Antes se
  // guardaba tal cual: un administrador creado con una lista que no incluyera
  // sus pantallas se quedaba sin una sola a la que entrar, y el guarda lo
  // devolvia al login, que lo mandaba de vuelta, en bucle.
  assert.equal(admin.secciones, null)
  assert.equal(puedeVerSeccion(admin.rol, admin.secciones, '/admin/usuarios'), true)

  const leido = await repo.actualizar(admin.id, { nombre: 'Jefe de sistemas' })
  assert.equal(leido.secciones, null)
  assert.equal(puedeVerSeccion(leido.rol, leido.secciones, '/admin/usuarios'), true)
})

test('la pantalla de entrada de un rol es una a la que de verdad puede entrar', async () => {
  // Es el mismo calculo que hace el guarda de las pantallas. Si las dos partes
  // no coinciden, el login manda a una pantalla que el guarda rechaza y el
  // rechazo devuelve al login: un bucle del que no se sale.
  const entradaAdmin = rutaInicialPorRol('ADMINISTRADOR', null)
  assert.equal(puedeVerSeccion('ADMINISTRADOR', null, entradaAdmin), true)

  const secciones = ['/operador/admisiones']
  const entradaOperador = rutaInicialPorRol('OPERADOR', secciones)
  assert.equal(puedeVerSeccion('OPERADOR', secciones, entradaOperador), true)
})

test('un usuario desactivado deja de tener sesion, sin importar sus permisos', async () => {
  const creado = await operadorNuevo('op.desactivado', ['/operador', '/admin/citas'])

  await repo.desactivar(creado.id)

  assert.equal(await repo.buscarPorId(creado.id), null)
  assert.equal(await repo.verificarCredenciales('op.desactivado', 'clave12345'), null)
})

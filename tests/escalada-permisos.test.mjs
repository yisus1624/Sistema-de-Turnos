// Que nadie se de a si mismo, ni le de a otro, mas acceso del que tiene.
//
// POR QUE ESTAS PRUEBAS EXISTEN. La regla de quien puede tocar la cuenta de
// quien estaba escrita a mano dentro de las dos rutas de la API, repetida y sin
// una sola prueba. Una auditoria encontro tres caminos abiertos, y el peor era
// este: un operador al que se le habia delegado la seccion de Usuarios —para
// que administrara cuentas del mostrador— le cambiaba la contraseña a OTRO
// operador que tuviera Citas y Registro de actividad, y entraba con esa cuenta.
// Acababa dentro de la agenda y de la bitacora sin ser administrador, y los
// apuntes quedaban a nombre del funcionario suplantado.
//
// Las reglas viven ahora en `politica-permisos`, que es puro, y cada camino de
// ataque tiene su caso aqui. Son pruebas de COMPORTAMIENTO: dicen que se puede
// y que no, no como esta escrito por dentro.
import assert from 'node:assert/strict'
import test from 'node:test'

const { revisarAlta, revisarCambio, alcanceDe } = await import('@/lib/usuarios/politica-permisos')

/** El administrador, que puede todo. */
const ADMIN = { id: 'u-admin', rol: 'ADMINISTRADOR', secciones: null }

/**
 * El actor peligroso: un operador cuyo UNICO acceso es administrar cuentas.
 * Es el caso real —al mostrador se le delega esa seccion— y el que abre la
 * puerta si las reglas miran solo que rol se asigna y no sobre quien se actua.
 */
const ENCARGADO_DE_CUENTAS = { id: 'u-cuentas', rol: 'OPERADOR', secciones: ['/admin/usuarios'] }

/** Una cuenta cualquiera, tal como esta guardada. */
function cuenta(campos) {
  return {
    id: 'u-otro',
    nombre: 'Otro Funcionario',
    usuario: 'otro',
    rol: 'OPERADOR',
    area: null,
    activo: true,
    fechaCreacion: new Date().toISOString(),
    secciones: null,
    ...campos,
  }
}

// ---------------------------------------------------------------------------
// La escalada que estaba abierta
// ---------------------------------------------------------------------------

test('no se le cambia la contrasena a una cuenta con mas accesos que la propia', () => {
  const conMasAcceso = cuenta({
    usuario: 'jefecitas',
    secciones: ['/admin/citas', '/admin/servicios', '/admin/seguridad'],
  })

  const rechazo = revisarCambio(ENCARGADO_DE_CUENTAS, conMasAcceso, { password: 'nuevaclave123' })

  assert.ok(rechazo, 'tomar la cuenta de otro cambiandole la contrasena tiene que rechazarse')
  assert.equal(rechazo.estado, 403)
})

test('el administrador si puede restablecerle la contrasena a cualquiera', () => {
  const conMasAcceso = cuenta({ secciones: ['/admin/citas', '/admin/seguridad'] })

  assert.equal(revisarCambio(ADMIN, conMasAcceso, { password: 'nuevaclave123' }), null)
})

test('a una cuenta que no alcanza mas lejos que la propia si se le puede cambiar la contrasena', () => {
  // Es el trabajo legitimo del encargado de cuentas: el operador del mostrador
  // que olvido su clave. Cerrar tambien este caso dejaria la seccion inutil.
  const delMostrador = cuenta({ secciones: ['/admin/usuarios'] })

  assert.equal(revisarCambio(ENCARGADO_DE_CUENTAS, delMostrador, { password: 'nuevaclave123' }), null)
})

// ---------------------------------------------------------------------------
// `null` no es "ninguna seccion": es "todas las de su rol"
// ---------------------------------------------------------------------------

test('crear una cuenta con secciones nulas no sirve para colar las del rol operador', () => {
  // `null` da /operador/agenda, /operador/admisiones y /operador/pantalla, que
  // el encargado de cuentas no tiene. El filtro viejo hacia `(secciones ?? [])`
  // y con null no tenia nada que comparar, asi que pasaba limpio.
  const rechazo = revisarAlta(ENCARGADO_DE_CUENTAS, { rol: 'OPERADOR', secciones: null })

  assert.ok(rechazo, 'secciones nulas conceden las del rol y tienen que compararse igual')
  assert.equal(rechazo.estado, 403)
})

test('ponerle secciones nulas a una cuenta existente tampoco cuela', () => {
  const delMostrador = cuenta({ secciones: ['/admin/usuarios'] })

  const rechazo = revisarCambio(ENCARGADO_DE_CUENTAS, delMostrador, { secciones: null })

  assert.ok(rechazo)
  assert.equal(rechazo.estado, 403)
})

test('el administrador si puede dejar una cuenta con las secciones de su rol', () => {
  assert.equal(revisarAlta(ADMIN, { rol: 'OPERADOR', secciones: null }), null)
})

// ---------------------------------------------------------------------------
// Una cuenta sin ninguna seccion no es un estado valido
// ---------------------------------------------------------------------------

test('una lista vacia se rechaza aunque la peticion no mande el rol', () => {
  // La regla vieja era `cambio.rol === 'OPERADOR' && ...`, asi que un cambio
  // que mandara solo `secciones: []` se la saltaba entera. El resultado
  // dependia de la implementacion: contra Postgres la cuenta terminaba con
  // TODAS las de su rol, y en memoria sin ni una.
  const rechazo = revisarCambio(ADMIN, cuenta({ secciones: ['/admin/citas'] }), { secciones: [] })

  assert.ok(rechazo, 'dejar a un operador sin ninguna pantalla no puede aceptarse')
  assert.equal(rechazo.estado, 400)
})

test('a un administrador no se le exige lista de secciones: siempre ve todo', () => {
  assert.equal(revisarAlta(ADMIN, { rol: 'ADMINISTRADOR', secciones: [] }), null)
})

// ---------------------------------------------------------------------------
// Lo que ya estaba cerrado, para que siga estandolo
// ---------------------------------------------------------------------------

test('nadie que no sea administrador se asciende a si mismo', () => {
  const yo = cuenta({ id: ENCARGADO_DE_CUENTAS.id, secciones: ['/admin/usuarios'] })

  const rechazo = revisarCambio(ENCARGADO_DE_CUENTAS, yo, { rol: 'ADMINISTRADOR' })

  assert.ok(rechazo)
  assert.equal(rechazo.estado, 403)
})

test('nadie se amplia sus propios permisos', () => {
  const yo = cuenta({ id: ENCARGADO_DE_CUENTAS.id, secciones: ['/admin/usuarios'] })

  const rechazo = revisarCambio(ENCARGADO_DE_CUENTAS, yo, {
    secciones: ['/admin/usuarios', '/admin/seguridad'],
  })

  assert.ok(rechazo)
  assert.equal(rechazo.estado, 403)
})

test('no se toca la cuenta de un administrador, ni siquiera para reactivarla', () => {
  // Se mira la cuenta REAL: si se mirara solo lo que la peticion pide, un
  // administrador dado de baja se reactivaba y se tomaba en la misma peticion.
  const jefe = cuenta({ id: 'u-jefe', rol: 'ADMINISTRADOR', activo: false })

  const rechazo = revisarCambio(ENCARGADO_DE_CUENTAS, jefe, {
    activo: true,
    password: 'nuevaclave123',
  })

  assert.ok(rechazo)
  assert.equal(rechazo.estado, 403)
})

test('un administrador no puede quitarse a si mismo el acceso', () => {
  // Es lo que garantiza que siempre quede alguien que pueda entrar a todo.
  const yo = cuenta({ id: ADMIN.id, rol: 'ADMINISTRADOR' })

  assert.ok(revisarCambio(ADMIN, yo, { activo: false }))
  assert.ok(revisarCambio(ADMIN, yo, { rol: 'OPERADOR' }))
})

test('no se reparten secciones sueltas que uno mismo no tiene', () => {
  const rechazo = revisarAlta(ENCARGADO_DE_CUENTAS, {
    rol: 'OPERADOR',
    secciones: ['/admin/usuarios', '/admin/seguridad'],
  })

  assert.ok(rechazo)
  assert.equal(rechazo.estado, 403)
})

test('si se reparte solo lo que uno tiene, se permite', () => {
  assert.equal(
    revisarAlta(ENCARGADO_DE_CUENTAS, { rol: 'OPERADOR', secciones: ['/admin/usuarios'] }),
    null,
  )
})

// ---------------------------------------------------------------------------
// El alcance, que es de donde salen todas las comparaciones
// ---------------------------------------------------------------------------

test('el alcance de una cuenta sin lista son las secciones de su rol', () => {
  const alcance = alcanceDe('OPERADOR', null)

  assert.ok(alcance.has('/operador/agenda'))
  assert.ok(alcance.has('/operador/admisiones'))
  assert.equal(alcance.has('/admin/usuarios'), false)
})

test('una lista vacia se trata igual que no tener lista, no como no tener acceso', () => {
  // Coherente con lo que guardan las dos implementaciones del repositorio,
  // que normalizan la lista vacia a null.
  assert.deepEqual([...alcanceDe('OPERADOR', [])], [...alcanceDe('OPERADOR', null)])
})

test('la contrasena propia no se cambia desde la administracion de usuarios: exige la actual en Mi cuenta', () => {
  const yo = { ...ADMIN, id: 'u-admin' }
  const rechazo = revisarCambio(ADMIN, cuenta({ id: yo.id, rol: 'ADMINISTRADOR', secciones: null }), {
    password: 'nuevaclave123',
  })

  assert.equal(rechazo?.estado, 403)
  assert.match(rechazo.motivo, /Mi cuenta/)
})

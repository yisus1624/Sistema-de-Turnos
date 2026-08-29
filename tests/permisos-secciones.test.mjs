// Permisos por seccion: el administrador ve todo y a un operador se le puede
// recortar el menu o darle secciones sueltas de administracion, sin volverlo
// administrador (ver `lib/permissions/rutas.ts`).
import assert from 'node:assert/strict'
import test from 'node:test'

const { secciones, seccionesDelRol, puedeVerSeccion, primeraRutaPermitida } = await import(
  '@/lib/permissions/rutas'
)

test('sin lista explicita, cada rol ve exactamente las secciones de su rol', () => {
  // El operador no entra a administracion por defecto...
  assert.equal(puedeVerSeccion('OPERADOR', null, '/operador'), true)
  assert.equal(puedeVerSeccion('OPERADOR', null, '/admin/usuarios'), false)

  // ...y el administrador no hereda las pantallas de operador.
  assert.equal(puedeVerSeccion('ADMINISTRADOR', null, '/admin/usuarios'), true)
  assert.equal(puedeVerSeccion('ADMINISTRADOR', null, '/operador'), false)
})

test('una lista explicita manda sobre el rol, en ambos sentidos', () => {
  const soloLlamado = ['/operador']

  assert.equal(puedeVerSeccion('OPERADOR', soloLlamado, '/operador'), true)
  // Le recortaron el resto de su propio menu.
  assert.equal(puedeVerSeccion('OPERADOR', soloLlamado, '/operador/agenda'), false)
})

test('a un operador se le puede dar una seccion de administracion', () => {
  const conReportes = ['/operador', '/admin/reportes']

  assert.equal(puedeVerSeccion('OPERADOR', conReportes, '/admin/reportes'), true)
  // Pero solo esa: no se le abre el resto de administracion.
  assert.equal(puedeVerSeccion('OPERADOR', conReportes, '/admin/usuarios'), false)
  assert.equal(puedeVerSeccion('OPERADOR', conReportes, '/admin/servicios'), false)
})

test('la lista vacia deja al usuario sin ninguna seccion', () => {
  assert.equal(puedeVerSeccion('OPERADOR', [], '/operador'), false)
  assert.equal(primeraRutaPermitida('OPERADOR', []), '/auth/login')
})

test('la ruta de entrada respeta el orden del menu, no el orden de la lista', () => {
  // Aunque se marcaron al reves, entra por la primera del menu.
  const ruta = primeraRutaPermitida('OPERADOR', ['/operador/historico', '/operador/agenda'])
  assert.equal(ruta, '/operador/agenda')
})

test('la entrada de un operador con solo una seccion de admin es esa seccion', () => {
  assert.equal(primeraRutaPermitida('OPERADOR', ['/admin/reportes']), '/admin/reportes')
})

test('por defecto cada rol entra a su primera seccion', () => {
  assert.equal(primeraRutaPermitida('ADMINISTRADOR', null), '/admin/turnos')
  assert.equal(primeraRutaPermitida('OPERADOR', null), '/operador/agenda')
})

test('el catalogo no tiene hrefs repetidos', () => {
  const hrefs = secciones.map((s) => s.href)
  assert.equal(new Set(hrefs).size, hrefs.length)
})

test('cada rol tiene al menos una seccion propia', () => {
  assert.ok(seccionesDelRol('ADMINISTRADOR').length > 0)
  assert.ok(seccionesDelRol('OPERADOR').length > 0)
})

// El sistema no puede quedarse sin administradores activos: ni desactivando
// ni degradando al ultimo.
import assert from 'node:assert/strict'
import test from 'node:test'

const { revisarQueQuedeUnAdministrador } = await import('@/lib/usuarios/politica-permisos')

function cuenta(id, rol, activo = true) {
  return { id, nombre: id, usuario: id, rol, area: null, activo, fechaCreacion: '', secciones: null, versionCredenciales: 0 }
}

const unico = cuenta('admin-1', 'ADMINISTRADOR')
const otroInactivo = cuenta('admin-2', 'ADMINISTRADOR', false)
const operador = cuenta('op-1', 'OPERADOR')

test('no se puede desactivar al ultimo administrador activo', () => {
  const rechazo = revisarQueQuedeUnAdministrador(unico, { activo: false }, [unico, otroInactivo, operador])
  assert.equal(rechazo?.estado, 400)
})

test('no se puede degradar al ultimo administrador activo', () => {
  assert.ok(revisarQueQuedeUnAdministrador(unico, { rol: 'OPERADOR' }, [unico, operador]))
})

test('con otro administrador activo si se puede', () => {
  const otro = cuenta('admin-3', 'ADMINISTRADOR')
  assert.equal(revisarQueQuedeUnAdministrador(unico, { activo: false }, [unico, otro]), null)
})

test('cambios que no le quitan el rol o a un operador pasan', () => {
  assert.equal(revisarQueQuedeUnAdministrador(unico, { password: 'nueva-clave' }, [unico]), null)
  assert.equal(revisarQueQuedeUnAdministrador(operador, { activo: false }, [unico, operador]), null)
})

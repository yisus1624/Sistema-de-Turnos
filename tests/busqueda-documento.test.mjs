// El documento del paciente NO viaja en la URL.
//
// La busqueda de admisiones lo mandaba como `?documento=`, y nginx escribe la
// URL entera en su access.log: cada paciente atendido dejaba su cedula en un
// archivo del servidor, legible por quien tenga acceso a los logs o a sus
// copias. Ahora va en el cuerpo de un POST, que no se registra.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

const { turnoRepository } = await import('./repositorios-en-memoria.mjs')

const sesion = {
  user: { id: 'u-admision', name: 'Ana', usuario: 'ana', rol: 'OPERADOR', area: null, secciones: ['/operador/admisiones'] },
}
mock.module('@/lib/auth', { namedExports: { auth: async () => sesion } })

const ruta = await import('@/app/api/turnos/citas/route')

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())

function buscar(cuerpo) {
  return ruta.POST(new Request('http://localhost/api/turnos/citas', { method: 'POST', body: JSON.stringify(cuerpo) }))
}

test('la ruta ya no acepta la busqueda por URL', () => {
  assert.equal(ruta.GET, undefined)
})

test('buscar por documento en el cuerpo devuelve las citas de hoy', async () => {
  const cita = await turnoRepository.crearCita({
    documentoPaciente: '55443322',
    nombrePaciente: 'Paciente Busqueda',
    profesionalId: 'pro-ramirez',
    horaCita: new Date(`${HOY}T09:30:00-05:00`).toISOString(),
  })

  const respuesta = await buscar({ documento: '55443322' })
  const { citas } = await respuesta.json()

  assert.equal(respuesta.status, 200)
  assert.ok(citas.some((c) => c.id === cita.id))
})

test('un documento demasiado corto o desmedido se rechaza con un aviso claro', async () => {
  assert.equal((await buscar({ documento: '12' })).status, 400)
  assert.equal((await buscar({ documento: '9'.repeat(200) })).status, 400)
  assert.equal((await buscar(null)).status, 400)
})

// Buscar por cedula es un dato del paciente: solo lo necesita quien registra
// llegadas. La pantalla de pruebas no busca documentos y aun asi tenia permiso.
test('sin la seccion de admisiones ni la de citas, la busqueda se rechaza con 403', async () => {
  const secciones = sesion.user.secciones
  try {
    sesion.user.secciones = ['/admin/pruebas']
    const respuesta = await buscar({ documento: '55443322' })
    assert.equal(respuesta.status, 403)
    assert.equal((await respuesta.json()).citas, undefined, 'no devuelve ninguna cita')
  } finally {
    sesion.user.secciones = secciones
  }
})

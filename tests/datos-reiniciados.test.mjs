// Reiniciar los datos del dia desde el panel de simulacion publica un evento
// para que TODAS las pantallas se pongan al dia al instante. Sin el, el
// televisor seguia mostrando los turnos borrados hasta un minuto.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

const { turnoRepository } = await import('./repositorios-en-memoria.mjs')

// La simulacion solo corre en la cuenta de demostracion (ver `simulacionHabilitada`).
let sesion = {
  user: {
    id: 'u-demo', name: 'Demo', usuario: 'demo', rol: 'ADMINISTRADOR', area: null, secciones: ['/admin/pruebas'],
    demostracion: true,
  },
}
mock.module('@/lib/auth', { namedExports: { auth: async () => sesion } })
mock.module('@/lib/seguridad/registro', {
  namedExports: {
    registrarEvento: async () => {},
    contextoPeticion: async () => ({ ip: null, agente: 'pruebas' }),
    limitarIntentos: () => ({ permitido: true, reintentarEnSegundos: 0 }),
    limpiarIntentos: () => {},
    listarEventos: async () => [],
    tiposDeEvento: async () => [],
    confiarEnProxy: false,
  },
})
const { enMundo, mundoDeDemostracion } = await import('@/lib/demostracion/mundo')
const { afectaALaFila } = await import('@/lib/realtime/canal')
const { eventoPideResincronizar } = await import('@/lib/turnos/pantalla-tv')
const { mezclarFotoDePantalla } = await import('@/lib/turnos/mezcla-pantalla')
const rutaSimulacion = await import('@/app/api/turnos/simulacion/route')

test('la ruta de simulacion publica datos.reiniciados en el canal de la demostracion', async () => {
  const demostracion = mundoDeDemostracion()
  const eventos = []
  const soltar = demostracion.hub.subscribe((evento) => eventos.push(evento))
  try {
    const respuesta = await enMundo(demostracion, () =>
      rutaSimulacion.POST(new Request('http://localhost/api/turnos/simulacion', { method: 'POST' })),
    )
    assert.equal(respuesta.status, 200)
  } finally {
    soltar()
  }
  assert.ok(eventos.some((e) => e.tipo === 'datos.reiniciados'))
  assert.ok(turnoRepository)
})

test('una cuenta real no puede correr la simulacion, ni con la variable de entorno puesta', async () => {
  const antes = sesion
  const variable = process.env.TURNOS_SIMULACION
  sesion = { user: { ...antes.user, id: 'u-admin', demostracion: false } }
  process.env.TURNOS_SIMULACION = '1'
  try {
    const respuesta = await rutaSimulacion.POST(new Request('http://localhost/api/turnos/simulacion', { method: 'POST' }))
    assert.equal(respuesta.status, 403)
  } finally {
    sesion = antes
    if (variable === undefined) delete process.env.TURNOS_SIMULACION
    else process.env.TURNOS_SIMULACION = variable
  }
})

test('el consultorio y la ventanilla lo dejan pasar: recargan', () => {
  const evento = { tipo: 'datos.reiniciados' }
  assert.equal(afectaALaFila(evento, { profesionalId: 'p1', moduloId: 'm1' }), true)
  assert.equal(afectaALaFila(evento, { servicioId: 's1' }), true)
})

test('el televisor se resincroniza, y la foto sin llamados no suena', () => {
  assert.equal(eventoPideResincronizar({ tipo: 'datos.reiniciados' }), true)
  assert.equal(eventoPideResincronizar({ tipo: 'configuracion.cambiada' }), true)
  assert.equal(eventoPideResincronizar({ tipo: 'modulo.liberado', moduloId: 'm1' }), false)

  const antes = [{ moduloId: 'm1', moduloNombre: 'C1', servicioId: 's', servicioNombre: 'CE', codigo: 'C-004', horaLlamado: new Date().toISOString(), vecesLlamado: 1 }]
  const reiniciada = [{ ...antes[0], codigo: null, horaLlamado: null, vecesLlamado: 0 }]
  assert.deepEqual(mezclarFotoDePantalla(antes, reiniciada, new Set(), Date.now()).llamadosNuevos, [])
})

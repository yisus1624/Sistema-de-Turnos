// Lo que hace la pantalla del doctor y la del operador cuando el servidor dice
// que el estado real es otro, y con que ventanilla arranca el operador.
import assert from 'node:assert/strict'
import test from 'node:test'

const { llamarSiguienteDesde } = await import('@/lib/api/llamado-cliente')
const { pedir, esCancelacion } = await import('@/lib/api/cliente')
const { ventanillaInicial } = await import('@/lib/ventanilla-recordada')

const TURNO_A = { id: 'a', codigo: 'C-001', estado: 'LLAMADO', vecesLlamado: 1 }

function servidor(respuesta, status = 200) {
  const enviados = []
  globalThis.fetch = async (url, init) => {
    enviados.push({ url, init })
    return new Response(JSON.stringify(respuesta), { status })
  }
  return enviados
}

test('manda el turno que la pantalla ve abierto', async () => {
  const enviados = servidor({ turno: { ...TURNO_A, id: 'b' } })

  const desenlace = await llamarSiguienteDesde('/api/x', { moduloId: 'm1' }, { turnoVisto: TURNO_A })

  assert.equal(desenlace.tipo, 'llamado')
  assert.deepEqual(JSON.parse(enviados[0].init.body), { moduloId: 'm1', turnoAbiertoId: 'a' })
})

test('un 409 con el turno real no es un error: la pantalla se pone al dia con el', async () => {
  servidor({ error: 'ya fue llamado', turnoActual: TURNO_A }, 409)

  const desenlace = await llamarSiguienteDesde('/api/x', { moduloId: 'm1' }, { turnoVisto: null })

  assert.deepEqual(desenlace, { tipo: 'ya_tenia_uno', turno: TURNO_A })
})

test('un 409 sin turno real (ventanilla ocupada por otro) si es un error visible', async () => {
  servidor({ error: 'Ventanilla 1 lo esta usando otro funcionario', turnoActual: null }, 409)

  await assert.rejects(
    () => llamarSiguienteDesde('/api/x', { moduloId: 'm1' }, { turnoVisto: null }),
    /lo esta usando/,
  )
})

test('cancelar la peticion desde fuera la corta aunque pedir lleve su propio limite', async () => {
  globalThis.fetch = (_url, init) =>
    new Promise((_resolver, rechazar) => init.signal.addEventListener('abort', () => rechazar(new Error('abortada'))))
  const control = new AbortController()

  const peticion = pedir('/api/x', { signal: control.signal })
  control.abort()

  await assert.rejects(peticion, (error) => esCancelacion(error))
})

// --- Ventanilla con la que arranca el operador ---------------------------------

const VENTANILLAS = [
  { id: 'v1', nombre: 'Ventanilla 1', activo: true },
  { id: 'v2', nombre: 'Ventanilla 2', activo: true },
]

test('con varias ventanillas y ninguna recordada, no se preselecciona ninguna', () => {
  // Preseleccionar "la primera" dejaba a dos operadores en la misma ventanilla.
  assert.equal(ventanillaInicial('s1', VENTANILLAS, null), '')
})

test('se retoma la ventanilla que este equipo eligio', () => {
  assert.equal(ventanillaInicial('s1', VENTANILLAS, 'v2'), 'v2')
})

test('si la recordada ya no existe, no se inventa otra', () => {
  assert.equal(ventanillaInicial('s1', VENTANILLAS, 'v9'), '')
})

test('si solo hay una ventanilla, se preselecciona', () => {
  assert.equal(ventanillaInicial('s1', [VENTANILLAS[0]], null), 'v1')
})

// En hora pico la base puede estar sin conexion libre un instante: el servidor
// rechaza el llamado entero con un 503 y el cliente lo reintenta solo.
test('un 503 (sistema ocupado) se reintenta solo y el llamado sale', async () => {
  let intentos = 0
  globalThis.fetch = async () => {
    intentos += 1
    return intentos < 3
      ? new Response(JSON.stringify({ error: 'El sistema esta muy ocupado' }), { status: 503 })
      : new Response(JSON.stringify({ turno: TURNO_A }), { status: 200 })
  }

  const desenlace = await llamarSiguienteDesde('/api/x', { moduloId: 'm1' }, { turnoVisto: null, esperasSiOcupado: [1, 1, 1] })

  assert.equal(desenlace.tipo, 'llamado')
  assert.equal(intentos, 3)
})

test('si sigue ocupado despues de los reintentos, el error se muestra', async () => {
  servidor({ error: 'El sistema esta muy ocupado' }, 503)

  await assert.rejects(
    () => llamarSiguienteDesde('/api/x', { moduloId: 'm1' }, { turnoVisto: null, esperasSiOcupado: [1, 1] }),
    /ocupado/,
  )
})

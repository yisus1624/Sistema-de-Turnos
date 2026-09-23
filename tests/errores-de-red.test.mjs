// Lo que ve el funcionario cuando falla la red.
//
// Sin red, el aviso decia "Failed to fetch": crudo, en ingles y sin decir que
// hacer. Y una peticion que la propia pantalla cancela (porque salio otra mas
// nueva) no es un error y no se puede mostrar como tal.
import assert from 'node:assert/strict'
import test from 'node:test'

const { pedir, esCancelacion } = await import('@/lib/api/cliente')

test('sin red: mensaje claro en español', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }

  await assert.rejects(
    () => pedir('/api/x'),
    (error) => /sin conexion con el servidor/i.test(error.message) && !/failed/i.test(error.message),
  )
})

test('una peticion cancelada por la propia pantalla no es un error que mostrar', async () => {
  globalThis.fetch = (_url, init) =>
    new Promise((_resolver, rechazar) =>
      init.signal.addEventListener('abort', () => rechazar(new DOMException('abortada', 'AbortError'))),
    )
  const control = new AbortController()

  const peticion = pedir('/api/x', { signal: control.signal })
  control.abort()

  await assert.rejects(peticion, (error) => esCancelacion(error))
})

test('un error de verdad no se confunde con una cancelacion', () => {
  assert.equal(esCancelacion(new Error('Sin conexion con el servidor.')), false)
})

test('un 429 o un 50x de nginx con HTML da un mensaje humano, no "error inesperado"', async () => {
  const casos = [
    [429, /demasiadas peticiones/i],
    [502, /no esta disponible/i],
    [503, /no esta disponible/i],
    [504, /tardo demasiado/i],
    [413, /demasiado grande/i],
  ]
  for (const [status, esperado] of casos) {
    globalThis.fetch = async () => new Response('<html><body>nginx</body></html>', { status })
    await assert.rejects(() => pedir('/api/x'), (error) => esperado.test(error.message) && error.status === status)
  }
})

test('si la API manda su propio mensaje, se respeta', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'El turno ya se cerro.' }), { status: 409 })
  await assert.rejects(() => pedir('/api/x'), /El turno ya se cerro/)
})

test('un formulario con archivo va sin la cabecera JSON, para que el navegador ponga la suya', async () => {
  let cabeceras
  globalThis.fetch = async (_url, init) => {
    cabeceras = new Headers(init.headers)
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  const cuerpo = new FormData()
  cuerpo.append('archivo', new Blob(['x']), 'reporte.xlsx')

  await pedir('/api/x', { method: 'POST', body: cuerpo })

  assert.equal(cabeceras.get('content-type'), null)
})

test('una subida lenta puede pedir su propio limite de tiempo', async () => {
  let senal
  globalThis.fetch = async (_url, init) => {
    senal = init.signal
    return new Response('{}', { status: 200 })
  }
  await pedir('/api/x', { msLimite: 180_000 })
  assert.equal(senal.aborted, false)
})

test('un 200 que no es JSON (portal cautivo) es "sin conexion", no una respuesta vacia', async () => {
  globalThis.fetch = async () => new Response('<html>Inicie sesion en la red WiFi</html>', { status: 200 })
  await assert.rejects(() => pedir('/api/x'), /sin conexion con el servidor/i)
})

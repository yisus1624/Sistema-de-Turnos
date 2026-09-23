// El inicio de sesion NO puede quedarse "Validando acceso..." para siempre, ni
// culpar a la contrasena de lo que es un corte de red.
//
// Con `signIn` de next-auth, un 429 o un 502 de nginx (cuerpo HTML) hacia
// reventar `res.json()`, la promesa se rechazaba sin nadie que la atrapara y el
// boton se quedaba cargando. Si fallaba el CSRF, el error llegaba como si las
// credenciales fueran malas. Y si fallaba la primera consulta de proveedores,
// la libreria sacaba al funcionario de la pagina.
//
// Aqui se prueba el ingreso contra un `fetch` de mentira: sin red, sin Next.
import assert from 'node:assert/strict'
import test from 'node:test'

const { ingresarConCredenciales, MENSAJES_DE_INGRESO } = await import('@/lib/auth-ingreso')

const CREDENCIALES = { usuario: 'admision1', password: 'secreta-123' }

function json(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } })
}

function html(status) {
  return new Response('<html><body>503 Service Temporarily Unavailable</body></html>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  })
}

/** Servidor de mentira: CSRF bien y, para las credenciales, lo que se indique. */
function servidor({ csrf = () => json({ csrfToken: 'tok-1' }), credenciales }) {
  const peticiones = []
  const pedir = async (url, init = {}) => {
    peticiones.push({ url, init })
    return url.endsWith('/csrf') ? csrf() : credenciales()
  }
  return { pedir, peticiones }
}

const urlDeError = (error, code) =>
  () => json({ url: `https://turnos/auth/login?error=${error}${code ? `&code=${code}` : ''}` })

test('credenciales buenas: entra, y manda el CSRF y los datos del formulario', async () => {
  const { pedir, peticiones } = servidor({ credenciales: () => json({ url: 'https://turnos/auth/redirect' }) })

  assert.equal(await ingresarConCredenciales(CREDENCIALES, pedir), 'ingreso')

  const envio = peticiones.at(-1)
  const cuerpo = new URLSearchParams(envio.init.body)
  assert.match(envio.url, /\/api\/auth\/callback\/credentials$/)
  assert.equal(envio.init.method, 'POST')
  assert.equal(cuerpo.get('csrfToken'), 'tok-1')
  assert.equal(cuerpo.get('usuario'), 'admision1')
})

test('credenciales malas: se dice que son malas', async () => {
  const { pedir } = servidor({ credenciales: urlDeError('CredentialsSignin', 'credentials') })
  assert.equal(await ingresarConCredenciales(CREDENCIALES, pedir), 'credenciales_invalidas')
})

test('base de datos caida: no se culpa a la contrasena', async () => {
  const { pedir } = servidor({ credenciales: urlDeError('CredentialsSignin', 'fuente_no_disponible') })
  assert.equal(await ingresarConCredenciales(CREDENCIALES, pedir), 'fuente_no_disponible')
})

test('nginx responde 429 con HTML: servidor ocupado, no credenciales', async () => {
  const { pedir } = servidor({ credenciales: () => html(429) })
  assert.equal(await ingresarConCredenciales(CREDENCIALES, pedir), 'servidor_ocupado')
})

test('el CSRF falla con un 502: servidor ocupado, y ni se intenta enviar', async () => {
  const { pedir, peticiones } = servidor({ csrf: () => html(502), credenciales: () => json({}) })

  assert.equal(await ingresarConCredenciales(CREDENCIALES, pedir), 'servidor_ocupado')
  assert.equal(peticiones.length, 1)
})

test('una respuesta 200 que no es JSON (portal cautivo, pagina de error): servidor ocupado', async () => {
  const { pedir } = servidor({ credenciales: () => html(200) })
  assert.equal(await ingresarConCredenciales(CREDENCIALES, pedir), 'servidor_ocupado')
})

test('sin internet: sin conexion', async () => {
  const pedir = async () => {
    throw new TypeError('Failed to fetch')
  }
  assert.equal(await ingresarConCredenciales(CREDENCIALES, pedir), 'sin_conexion')
})

test('internet tan lento que vence la espera: sin conexion, no carga eterna', async () => {
  const pedir = async () => {
    throw new DOMException('La espera vencio', 'TimeoutError')
  }
  assert.equal(await ingresarConCredenciales(CREDENCIALES, pedir), 'sin_conexion')
})

test('cada peticion lleva un tope de espera', async () => {
  const { pedir, peticiones } = servidor({ credenciales: () => json({ url: 'https://turnos/auth/redirect' }) })
  await ingresarConCredenciales(CREDENCIALES, pedir)

  assert.equal(peticiones.every((p) => p.init.signal instanceof AbortSignal), true)
})

test('el CSRF no cuadra: fallo del sistema, no contrasena incorrecta', async () => {
  const { pedir } = servidor({ credenciales: urlDeError('MissingCSRF') })
  const resultado = await ingresarConCredenciales(CREDENCIALES, pedir)

  assert.equal(resultado, 'fallo_inesperado')
  assert.doesNotMatch(MENSAJES_DE_INGRESO[resultado], /incorrect/i)
})

test('solo el rechazo de credenciales habla de la contrasena como culpable', () => {
  const culpanALaClave = Object.entries(MENSAJES_DE_INGRESO)
    .filter(([, mensaje]) => /incorrect/i.test(mensaje))
    .map(([tipo]) => tipo)

  assert.deepEqual(culpanALaClave, ['credenciales_invalidas'])
})

test('una cuenta en espera por intentos fallidos no se reporta como contrasena incorrecta', async () => {
  const { pedir } = servidor({ credenciales: urlDeError('CredentialsSignin', 'cuenta_en_espera') })
  const resultado = await ingresarConCredenciales(CREDENCIALES, pedir)

  assert.equal(resultado, 'cuenta_en_espera')
  assert.match(MENSAJES_DE_INGRESO[resultado], /espera/i)
  assert.doesNotMatch(MENSAJES_DE_INGRESO[resultado], /incorrect/i)
})

test('las dos peticiones comparten UNA espera maxima, no una cada una', async () => {
  const { pedir, peticiones } = servidor({ credenciales: () => json({ url: 'https://turnos/auth/redirect' }) })
  await ingresarConCredenciales(CREDENCIALES, pedir)

  assert.equal(peticiones[0].init.signal, peticiones[1].init.signal)
})

// Acceso de doctores por enlace temporal, sin usuario ni contrasena (RF
// pendiente, confirmado por el hospital). La vigencia la elige el
// administrador en horas y minutos porque los turnos de manana, tarde y
// noche duran distinto.
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

const repo = new InMemoryTurnoRepository()

test('un token valido devuelve el profesional y registra el ultimo uso', async () => {
  const { acceso, token } = await repo.crearAccesoProfesional('pro-perez', 60)

  const profesional = await repo.validarAccesoProfesional(token)
  assert.ok(profesional)
  assert.equal(profesional.id, 'pro-perez')

  const [guardado] = (await repo.listarAccesosProfesional()).filter((a) => a.id === acceso.id)
  assert.ok(guardado.ultimoUsoEn, 'debe quedar registrado el ultimo uso')
})

test('un token inexistente devuelve null', async () => {
  const profesional = await repo.validarAccesoProfesional('token-que-jamas-se-genero')
  assert.equal(profesional, null)
})

test('un token revocado deja de servir', async () => {
  const { acceso, token } = await repo.crearAccesoProfesional('pro-gomez', 60)
  await repo.revocarAccesoProfesional(acceso.id)

  const profesional = await repo.validarAccesoProfesional(token)
  assert.equal(profesional, null)
})

test('crear un enlace nuevo revoca el anterior: un doctor, un enlace activo', async () => {
  const primero = await repo.crearAccesoProfesional('pro-salas', 60)
  const segundo = await repo.crearAccesoProfesional('pro-salas', 60)

  assert.equal(await repo.validarAccesoProfesional(primero.token), null, 'el enlace viejo ya no debe servir')

  const profesional = await repo.validarAccesoProfesional(segundo.token)
  assert.ok(profesional)
  assert.equal(profesional.id, 'pro-salas')
})

test('el hash guardado no permite recuperar el token en claro', async () => {
  const { token } = await repo.crearAccesoProfesional('pro-rios', 60)

  const accesos = await repo.listarAccesosProfesional()
  const serializado = JSON.stringify(accesos)
  assert.equal(serializado.includes(token), false, 'el token en claro no debe viajar en la lista de accesos')

  for (const acceso of accesos) {
    assert.equal('token' in acceso, false)
    assert.equal('tokenHash' in acceso, false)
  }
})

test('la vigencia se respeta al minuto: sigue valido a los 10 min y ya no a los 20 (enlace de 15 min)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })

  const { token } = await repo.crearAccesoProfesional('pro-perez', 15)

  t.mock.timers.tick(10 * 60 * 1000)
  assert.ok(await repo.validarAccesoProfesional(token), 'a los 10 minutos deberia seguir vigente')

  t.mock.timers.tick(10 * 60 * 1000) // quedan 20 minutos transcurridos en total
  assert.equal(await repo.validarAccesoProfesional(token), null, 'a los 20 minutos ya deberia estar vencido')
})

test('la API rechaza duraciones fuera del rango permitido (15 min a 72 horas)', async () => {
  await assert.rejects(() => repo.crearAccesoProfesional('pro-perez', 0), /vigencia/i)
  await assert.rejects(() => repo.crearAccesoProfesional('pro-perez', 5000), /vigencia/i)
})

test('no se puede generar un acceso para un profesional inexistente', async () => {
  await assert.rejects(() => repo.crearAccesoProfesional('pro-no-existe', 60), /profesional/i)
})

// ---------------------------------------------------------------------------
// VOLVER A VER EL ENLACE VIGENTE
// ---------------------------------------------------------------------------
//
// El mostrador pierde el mensaje con el enlace todos los dias: se borra, lo
// genero el compañero del otro turno, se cerro el navegador. Antes la unica
// salida era generar otro, y eso revoca el anterior y deja fuera al doctor que
// en ese momento esta llamando pacientes.
//
// Lo que se prueba aqui no es que se pueda ver —eso es lo facil—, sino que DEJE
// de poder verse en las tres situaciones en las que el enlace muere: revocado,
// reemplazado por uno nuevo y vencido. Si alguna de esas falla, el sistema
// queda guardando una llave legible de algo que ya no deberia abrir.

test('el enlace vigente se puede volver a consultar sin generar otro', async () => {
  const { token } = await repo.crearAccesoProfesional('pro-perez', 60)

  assert.equal(await repo.tokenVigenteDeProfesional('pro-perez'), token)
  // Consultarlo no lo cambia: el doctor sigue entrando con el mismo.
  assert.ok(await repo.validarAccesoProfesional(token))
  assert.equal(await repo.tokenVigenteDeProfesional('pro-perez'), token)
})

test('al revocar el enlace deja de poder consultarse', async () => {
  const { acceso } = await repo.crearAccesoProfesional('pro-gomez', 60)
  assert.ok(await repo.tokenVigenteDeProfesional('pro-gomez'))

  await repo.revocarAccesoProfesional(acceso.id)
  assert.equal(await repo.tokenVigenteDeProfesional('pro-gomez'), null)

  // Revocar dos veces tampoco puede dejarlo legible.
  await repo.revocarAccesoProfesional(acceso.id)
  assert.equal(await repo.tokenVigenteDeProfesional('pro-gomez'), null)
})

test('al generar uno nuevo, el anterior deja de poder consultarse y se devuelve el nuevo', async () => {
  const primero = await repo.crearAccesoProfesional('pro-salas', 60)
  const segundo = await repo.crearAccesoProfesional('pro-salas', 60)

  const consultado = await repo.tokenVigenteDeProfesional('pro-salas')
  assert.equal(consultado, segundo.token, 'debe devolver el ultimo, nunca el viejo')
  assert.notEqual(consultado, primero.token)
  assert.equal(await repo.validarAccesoProfesional(primero.token), null)
})

test('un enlace vencido no se puede consultar', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })

  await repo.crearAccesoProfesional('pro-rios', 15)
  assert.ok(await repo.tokenVigenteDeProfesional('pro-rios'))

  t.mock.timers.tick(20 * 60 * 1000)
  assert.equal(await repo.tokenVigenteDeProfesional('pro-rios'), null)
})

test('un doctor sin enlace no devuelve nada', async () => {
  assert.equal(await repo.tokenVigenteDeProfesional('pro-ana'), null)
})

test('la copia recuperable no se escapa en la lista de accesos', async () => {
  const { token } = await repo.crearAccesoProfesional('pro-perez', 60)

  const serializado = JSON.stringify(await repo.listarAccesosProfesional())
  assert.equal(serializado.includes(token), false, 'el token no debe viajar en la lista')
  for (const acceso of await repo.listarAccesosProfesional()) {
    assert.equal('tokenGuardado' in acceso, false)
    assert.equal('tokenCifrado' in acceso, false)
  }
})

test('validar un enlace vencido tambien borra su copia recuperable', async (t) => {
  /*
    El borrado por vencimiento vivia SOLO en `tokenVigenteDeProfesional`, o sea
    que solo ocurria si alguien abria la pantalla de enlaces. Un enlace
    generado el viernes que vencia esa noche, para un doctor al que nadie le
    vuelve a generar otro, se quedaba con su copia descifrable en la tabla
    indefinidamente. El doctor que reabre su pestaña vencida pasa por
    `validarAccesoProfesional`, que es el camino que de verdad se recorre.

    COMO SE COMPRUEBA QUE LA COPIA SE BORRO. Preguntar por ella con el enlace
    ya vencido no demuestra nada: `tokenVigenteDeProfesional` devuelve null por
    vencimiento, haya copia o no, asi que la prueba pasaria igual sin el
    arreglo. Por eso se retrocede el reloj a un instante en el que el enlace
    TODAVIA era valido: si la copia sigue ahi, la devuelve; si se borro, no
    puede. Viajar en el tiempo es artificial, pero es lo que aisla exactamente
    la linea que se quiere fijar.
  */
  t.mock.timers.enable({ apis: ['Date'] })

  const inicio = Date.now()
  const { token } = await repo.crearAccesoProfesional('pro-torres', 15)

  // Antes de vencer, la copia esta y se devuelve.
  assert.equal(await repo.tokenVigenteDeProfesional('pro-torres'), token)

  // Vence y el doctor recarga su pestaña: le dicen que ya no vale.
  t.mock.timers.setTime(inicio + 20 * 60 * 1000)
  assert.equal(await repo.validarAccesoProfesional(token), null)

  // Se vuelve a un instante en el que el enlace aun era vigente. La copia ya
  // no puede aparecer: la borro la validacion.
  t.mock.timers.setTime(inicio + 5 * 60 * 1000)
  assert.equal(
    await repo.tokenVigenteDeProfesional('pro-torres'),
    null,
    'la copia sobrevivio al vencimiento',
  )
})

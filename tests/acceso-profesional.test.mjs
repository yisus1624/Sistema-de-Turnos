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

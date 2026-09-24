// El doctor debe enterarse de que su enlace va a vencer antes de que le pase
// a media consulta.
import assert from 'node:assert/strict'
import test from 'node:test'

const { minutosParaVencer } = await import('@/lib/consultorio/presentacion')
const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')

const AHORA = Date.parse('2026-09-23T15:00:00Z')
const dentroDe = (minutos) => new Date(AHORA + minutos * 60000).toISOString()

test('avisa cuando faltan 30 minutos o menos', () => {
  assert.equal(minutosParaVencer(dentroDe(30), AHORA), 30)
  assert.equal(minutosParaVencer(dentroDe(5), AHORA), 5)
})

test('no avisa si falta mas de media hora o no se sabe cuando vence', () => {
  assert.equal(minutosParaVencer(dentroDe(31), AHORA), null)
  assert.equal(minutosParaVencer(undefined, AHORA), null)
  assert.equal(minutosParaVencer(null, AHORA), null)
})

test('el repositorio dice cuando vence el enlace del token, y nada si no existe o se revoco', async () => {
  const repo = new InMemoryTurnoRepository()
  const { acceso, token } = await repo.crearAccesoProfesional('pro-perez', 60)
  assert.equal(await repo.expiracionDelAcceso(token), acceso.expiraEn)
  assert.equal(await repo.expiracionDelAcceso('token-que-jamas-se-genero'), null)
  await repo.revocarAccesoProfesional(acceso.id)
  assert.equal(await repo.expiracionDelAcceso(token), null)
})

// `ultimoUsoEn` del enlace de consultorio se escribia en CADA peticion del
// doctor, y la pantalla del doctor recarga con cada evento del hospital: una
// escritura en la base por recarga y por consultorio, solo para mostrar
// "ultimo uso" en la pantalla de enlaces. Basta con apuntarlo cada pocos
// minutos.
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')
const { MS_ENTRE_APUNTES_DE_USO } = await import('@/lib/turnos/repository')

const repo = new InMemoryTurnoRepository()

async function ultimoUso(profesionalId) {
  return (await repo.listarAccesosProfesional()).find((a) => a.profesionalId === profesionalId)?.ultimoUsoEn
}

test('el uso seguido del enlace no reescribe el ultimo uso en cada peticion', async () => {
  const { token } = await repo.crearAccesoProfesional('pro-rios', 60)

  await repo.validarAccesoProfesional(token)
  const primero = await ultimoUso('pro-rios')
  await new Promise((resolver) => setTimeout(resolver, 15))
  await repo.validarAccesoProfesional(token)

  assert.ok(primero)
  assert.equal(await ultimoUso('pro-rios'), primero)
  assert.ok(MS_ENTRE_APUNTES_DE_USO >= 60_000)
})

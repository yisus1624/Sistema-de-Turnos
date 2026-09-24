// Dar de baja a un doctor tiene que cortar su enlace de consultorio: si se le
// reactiva antes de que venza, el enlace viejo no puede volver a abrir.
import assert from 'node:assert/strict'
import test from 'node:test'

const { revocarAccesosVigentesDe } = await import('@/lib/turnos/revocacion-accesos')

const AHORA = new Date('2026-09-23T12:00:00Z')

function acceso(campos) {
  return { id: 'a1', profesionalId: 'p1', creadoEn: '', expiraEn: '2026-09-24T12:00:00Z', revocadoEn: null, ultimoUsoEn: null, ...campos }
}

function repoCon(accesos) {
  const revocados = []
  return {
    revocados,
    listarAccesosProfesional: async () => accesos,
    revocarAccesoProfesional: async (id) => {
      revocados.push(id)
      return { ...accesos.find((a) => a.id === id), revocadoEn: AHORA.toISOString() }
    },
  }
}

test('revoca solo el acceso vigente del doctor dado de baja', async () => {
  const repo = repoCon([
    acceso({ id: 'vigente' }),
    acceso({ id: 'de-otro', profesionalId: 'p2' }),
    acceso({ id: 'vencido', expiraEn: '2026-09-22T12:00:00Z' }),
    acceso({ id: 'ya-revocado', revocadoEn: '2026-09-23T10:00:00Z' }),
  ])

  const revocados = await revocarAccesosVigentesDe(repo, 'p1', AHORA)

  assert.deepEqual(repo.revocados, ['vigente'])
  assert.deepEqual(revocados.map((a) => a.id), ['vigente'])
})

test('un doctor sin enlace vigente no revoca nada', async () => {
  const repo = repoCon([])
  assert.deepEqual(await revocarAccesosVigentesDe(repo, 'p1', AHORA), [])
})

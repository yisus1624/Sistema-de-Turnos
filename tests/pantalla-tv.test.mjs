// El televisor de la sala de espera se recupera solo.
//
// Tras un apagon o un reinicio del PC, el televisor se quedaba en la portada
// "Activar pantalla" hasta que alguien hiciera clic: la sala sin turnos y sin
// canal. Ahora pinta los turnos y abre el canal desde el primer momento; el
// clic solo hace falta para el sonido, y ni eso si el navegador ya lo permite
// (kiosco con --autoplay-policy=no-user-gesture-required).
import assert from 'node:assert/strict'
import test from 'node:test'

const { decidirEstadoDelAudio } = await import('@/lib/turnos/anuncio')
const { avisoDeSonido, mensajeSinCasillas, filasDeCartelera } = await import(
  '@/lib/turnos/pantalla-tv'
)

// --- Audio -------------------------------------------------------------------

test('si el navegador declara que permite el audio, suena sin clic', () => {
  assert.equal(decidirEstadoDelAudio({ politica: 'allowed', estadoContexto: 'suspended' }), 'permitido')
})

test('si la politica lo prohibe, queda bloqueado aunque el contexto diga otra cosa', () => {
  assert.equal(decidirEstadoDelAudio({ politica: 'disallowed', estadoContexto: 'running' }), 'bloqueado')
  assert.equal(decidirEstadoDelAudio({ politica: 'allowed-muted', estadoContexto: 'running' }), 'bloqueado')
})

test('sin politica declarada, manda el estado del contexto de audio', () => {
  assert.equal(decidirEstadoDelAudio({ estadoContexto: 'running' }), 'permitido')
  assert.equal(decidirEstadoDelAudio({ estadoContexto: 'suspended' }), 'bloqueado')
})

test('sin audio en el navegador, no hay nada que desbloquear', () => {
  assert.equal(decidirEstadoDelAudio({}), 'sin_audio')
})

test('el aviso de sonido solo sale si alguien deberia oir y el navegador no deja', () => {
  const base = { audio: 'bloqueado', mudoDelTelevisor: false, audioDelHospital: true }
  assert.equal(avisoDeSonido(base), 'tocar_para_activar')
  assert.equal(avisoDeSonido({ ...base, audio: 'permitido' }), null)
  assert.equal(avisoDeSonido({ ...base, mudoDelTelevisor: true }), null, 'el mudo de esta sala se respeta')
  assert.equal(avisoDeSonido({ ...base, audioDelHospital: false }), null)
})

// --- Estado inicial -------------------------------------------------------------

test('sin datos todavia la sala no lee que no hay consultorios', () => {
  assert.match(mensajeSinCasillas('cargando'), /conectando/i)
  assert.match(mensajeSinCasillas('sin_conexion'), /conectando/i)
  assert.doesNotMatch(mensajeSinCasillas('sin_conexion'), /no hay consultorios/i)
  assert.match(mensajeSinCasillas('listo'), /no hay consultorios/i)
})

// --- Cartelera -------------------------------------------------------------------

function casilla(n, cambios = {}) {
  return {
    moduloId: `m${n}`,
    moduloNombre: `CONS ${n}`,
    servicioId: 's',
    servicioNombre: 'Consulta externa',
    codigo: `C-${String(n).padStart(3, '0')}`,
    horaLlamado: new Date(Date.UTC(2026, 8, 22, 14, n)).toISOString(),
    vecesLlamado: 1,
    ...cambios,
  }
}

test('con 12 consultorios llamando, la cartelera los muestra a los 12', () => {
  const casillas = Array.from({ length: 12 }, (_, i) => casilla(i + 1))
  const { filas, masReciente } = filasDeCartelera(casillas)

  assert.equal(filas.length, 12, 'ningun paciente llamado desaparece del televisor')
  assert.equal(masReciente.moduloId, 'm12')
})

// Con cada llamado las filas se reordenaban (el mas reciente arriba) y el
// paciente perdia de vista a su doctor. Ahora cada uno queda en su sitio.
test('las filas no cambian de lugar cuando alguien llama', () => {
  const antes = Array.from({ length: 5 }, (_, i) => casilla(i + 1))
  const despues = antes.map((c) => (c.moduloId === 'm2' ? { ...c, codigo: 'C-099', horaLlamado: '2026-09-22T20:00:00.000Z' } : c))

  const orden = (lista) => filasDeCartelera(lista).filas.map((c) => c.moduloId)
  assert.deepEqual(orden(despues), orden(antes))
  assert.equal(filasDeCartelera(despues).masReciente.moduloId, 'm2')
})

test('el orden es por consultorio con su numero, y dentro por doctor', () => {
  const lista = [
    casilla(1, { moduloNombre: 'CONS 10', profesionalNombre: 'B' }),
    casilla(2, { moduloNombre: 'CONS 2', profesionalNombre: 'Z' }),
    casilla(3, { moduloNombre: 'CONS 2', profesionalNombre: 'A' }),
  ]
  assert.deepEqual(filasDeCartelera(lista).filas.map((c) => c.moduloId), ['m3', 'm2', 'm1'])
})

test('los consultorios libres no ocupan fila', () => {
  const casillas = [casilla(1), casilla(2, { codigo: null, horaLlamado: null })]
  assert.deepEqual(filasDeCartelera(casillas).filas.map((c) => c.moduloId), ['m1'])
})

test('sin llamados no hay filas', () => {
  const { filas, masReciente } = filasDeCartelera([casilla(1, { codigo: null })])
  assert.deepEqual(filas, [])
  assert.equal(masReciente, null)
})


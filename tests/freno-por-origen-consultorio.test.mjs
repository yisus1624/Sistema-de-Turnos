// Un freno por origen no puede tumbar a los doctores que ya estaban trabajando.
//
// Todo el hospital sale a internet por una sola IP. El freno contra la fuerza
// bruta (500 fallos en 5 minutos desde un mismo origen) se miraba ANTES de
// validar el token y rechazaba tambien los enlaces BUENOS con el mismo 401 de
// "enlace no valido": bastaba un equipo del wifi de pacientes probando tokens
// para que TODOS los consultorios quedaran en rojo, y la pantalla del doctor,
// que lee ese 401 como enlace vencido, dejaba de intentarlo para siempre.
//
// Ahora el freno sigue cortando, sin llegar a la base, los tokens que el
// servidor no ha visto entrar (la fuerza bruta sigue frenada); el enlace que ya
// entro bien pasa; y lo que se frena responde 429, "espera y vuelve", que la
// pantalla reintenta sola.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

// ANTES QUE NADA: sin esto las pruebas escriben en la base real del hospital.
const { turnoRepository } = await import('./repositorios-en-memoria.mjs')

// El limitador va DE VERDAD: es justo lo que se esta probando. Se sustituye la
// escritura del registro (que es Prisma) y la IP de la peticion.
const { limitarIntentos, limpiarIntentos } = await import('@/lib/seguridad/registro')

const apuntes = []
let ipDeLaPeticion = null

mock.module('@/lib/seguridad/registro', {
  namedExports: {
    limitarIntentos,
    limpiarIntentos,
    registrarEvento: async (evento) => {
      apuntes.push(evento)
    },
    contextoPeticion: async () => ({ ip: ipDeLaPeticion, agente: 'pruebas' }),
    listarEventos: async () => [],
    tiposDeEvento: async () => [],
    confiarEnProxy: true,
  },
})

const { requireProfesionalPorToken, errorConsultorio } = await import('@/lib/turnos/acceso-consultorio')

/** Cuantas veces se fue a la base (al repositorio) a validar un token. */
let consultasALaBase = 0
const validarDeVerdad = turnoRepository.validarAccesoProfesional.bind(turnoRepository)
turnoRepository.validarAccesoProfesional = async (token) => {
  consultasALaBase += 1
  return validarDeVerdad(token)
}

/** Un token inventado CON el formato real (43 caracteres base64url). */
function inventado(nombre, n = 0) {
  return `${String(n).padStart(6, '0')}${nombre.replace(/[^A-Za-z0-9_-]/g, '')}${'x'.repeat(43)}`.slice(0, 43)
}

const ultimoMotivo = () => apuntes.at(-1)?.detalle?.motivo

/** Deja el origen frenado: mas fallos que el tope, con tokens inventados. */
async function frenarOrigen(ip) {
  ipDeLaPeticion = ip
  for (let intento = 1; intento <= 510; intento += 1) {
    await requireProfesionalPorToken(inventado(`f${ip}`, intento)).catch(() => {})
  }
  assert.equal(ultimoMotivo(), 'demasiados_intentos_ip', 'el origen tiene que haber quedado frenado')
}

/** El error con el que se rechazo la peticion. */
async function rechazoDe(promesa) {
  try {
    await promesa
  } catch (error) {
    return error
  }
  assert.fail('se esperaba un rechazo')
}

test('con el origen frenado, el doctor que ya estaba trabajando sigue entrando', async () => {
  ipDeLaPeticion = '181.52.13.10'
  const { token } = await turnoRepository.crearAccesoProfesional('pro-perez', 60)
  assert.equal((await requireProfesionalPorToken(token)).id, 'pro-perez')

  await frenarOrigen('181.52.13.10')

  for (let peticion = 1; peticion <= 5; peticion += 1) {
    const profesional = await requireProfesionalPorToken(token)
    assert.equal(profesional.id, 'pro-perez', `la peticion ${peticion} del enlace bueno no puede frenarse`)
  }
})

test('con el origen frenado, un token que nunca entro no llega a la base: la fuerza bruta sigue cortada', async () => {
  await frenarOrigen('181.52.13.11')
  const antes = consultasALaBase

  for (let intento = 1; intento <= 50; intento += 1) {
    await assert.rejects(() => requireProfesionalPorToken(inventado('bruta', intento)))
    assert.equal(ultimoMotivo(), 'demasiados_intentos_ip')
  }
  assert.equal(consultasALaBase, antes, 'ningun intento frenado consulta la base')
})

test('el freno responde 429 (vuelve a intentarlo) y se levanta solo, no el 401 de enlace vencido', async () => {
  await frenarOrigen('181.52.13.12')
  // Un enlace bueno que este servidor todavia no habia visto entrar: sin ir a la
  // base no se distingue de uno inventado, asi que espera como los demas, pero
  // con un codigo que la pantalla del doctor reintenta sola.
  const { token } = await turnoRepository.crearAccesoProfesional('pro-gomez', 60)

  const frenado = await rechazoDe(requireProfesionalPorToken(token))
  assert.equal(frenado.status, 429)
  const respuesta = errorConsultorio(frenado)
  assert.equal(respuesta.status, 429)
  assert.doesNotMatch((await respuesta.json()).error, /no es valido|vencio|enlace nuevo/i)

  // Pasada la ventana del freno, el mismo enlace entra sin que nadie haga nada.
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  try {
    mock.timers.tick(6 * 60 * 1000)
    assert.equal((await requireProfesionalPorToken(token)).id, 'pro-gomez')
  } finally {
    mock.timers.reset()
  }
})

test('un enlace conocido que se revoca deja de pasar, y el freno lo vuelve a cortar antes de la base', async () => {
  ipDeLaPeticion = '181.52.13.13'
  const { acceso, token } = await turnoRepository.crearAccesoProfesional('pro-perez', 60)
  await requireProfesionalPorToken(token)
  await frenarOrigen('181.52.13.13')
  await turnoRepository.revocarAccesoProfesional(acceso.id)

  const revocado = await rechazoDe(requireProfesionalPorToken(token))
  assert.equal(revocado.status, 401, 'revocado es revocado, aunque haya entrado bien antes')

  const antes = consultasALaBase
  const otraVez = await rechazoDe(requireProfesionalPorToken(token))
  assert.equal(otraVez.status, 429)
  assert.equal(consultasALaBase, antes, 'ya no cuenta como conocido: no vuelve a la base mientras dure el freno')
})

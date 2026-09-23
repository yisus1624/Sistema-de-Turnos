// Las pantallas internas se recuperan solas cuando falla una carga.
//
// El canal en vivo solo avisa cuando PASA algo. Si la carga de la pantalla
// falla (429, 500, se vencio la espera) y el canal sigue vivo, antes la
// pantalla se quedaba en "Sin conexion" hasta el proximo evento que le
// interesara, que en un consultorio tranquilo podia tardar media hora. Ahora
// reintenta sola con espera creciente, hasta lograrlo.
import assert from 'node:assert/strict'
import test from 'node:test'

const { crearReintento, esReintentable, esperaDeReintento } = await import('@/lib/api/reintento')
const { ErrorApi, PeticionCancelada } = await import('@/lib/api/cliente')

/** Un reloj de mentira: guarda lo programado para dispararlo a mano. */
function relojDePrueba() {
  const reloj = { pendientes: [] }
  reloj.programar = (accion, ms) => {
    const entrada = { accion, ms, cancelada: false }
    reloj.pendientes.push(entrada)
    return () => {
      entrada.cancelada = true
    }
  }
  reloj.disparar = () => {
    const entrada = reloj.pendientes.shift()
    if (entrada && !entrada.cancelada) entrada.accion()
  }
  return reloj
}

const sinAzar = (intento) => esperaDeReintento(intento, 0.5)

test('tras un fallo reintenta, y cada fallo seguido espera mas', () => {
  const reloj = relojDePrueba()
  let intentos = 0
  const reintento = crearReintento({ programar: reloj.programar, espera: sinAzar })
  const intentar = () => {
    intentos += 1
    reintento.programar(intentar)
  }

  reintento.programar(intentar)
  reloj.disparar()
  reloj.disparar()

  assert.equal(intentos, 2)
  assert.deepEqual(reloj.pendientes.map((p) => p.ms), [8000])
})

test('al lograrlo se cancela lo pendiente y la espera vuelve a empezar', () => {
  const reloj = relojDePrueba()
  const reintento = crearReintento({ programar: reloj.programar, espera: sinAzar })

  reintento.programar(() => {})
  reintento.exito()
  reintento.programar(() => {})

  assert.equal(reloj.pendientes[0].cancelada, true)
  assert.equal(reloj.pendientes[1].ms, 2000, 'otra vez desde la espera corta')
})

test('no se apilan reintentos: varios fallos a la vez programan uno solo', () => {
  const reloj = relojDePrueba()
  const reintento = crearReintento({ programar: reloj.programar, espera: sinAzar })

  reintento.programar(() => {})
  reintento.programar(() => {})
  reintento.programar(() => {})

  assert.equal(reloj.pendientes.length, 1)
})

test('al desmontar se cancela', () => {
  const reloj = relojDePrueba()
  let intentos = 0
  const reintento = crearReintento({ programar: reloj.programar, espera: sinAzar })

  reintento.programar(() => {
    intentos += 1
  })
  reintento.cancelar()
  reloj.disparar()

  assert.equal(intentos, 0)
})

test('se reintenta lo pasajero, no el enlace vencido ni lo que cancelo la propia pantalla', () => {
  assert.equal(esReintentable(new ErrorApi('ocupado', 429)), true)
  assert.equal(esReintentable(new ErrorApi('fallo', 500)), true)
  assert.equal(esReintentable(new Error('Sin conexion con el servidor.')), true)
  assert.equal(esReintentable(new ErrorApi('enlace vencido', 401)), false)
  assert.equal(esReintentable(new ErrorApi('sin permiso', 403)), false)
  assert.equal(esReintentable(new PeticionCancelada()), false)
})

test('programar despues de cancelar no programa nada: sin ciclos zombi tras salir de la pantalla', () => {
  const reloj = relojDePrueba()
  const reintento = crearReintento({ programar: reloj.programar, espera: sinAzar })

  reintento.cancelar()
  reintento.programar(() => {})

  assert.equal(reloj.pendientes.length, 0)
})

test('un 400 o un 404 no se reintentan: repetirlos no los arregla', () => {
  assert.equal(esReintentable(new ErrorApi('dato invalido', 400)), false)
  assert.equal(esReintentable(new ErrorApi('no existe', 404)), false)
  assert.equal(esReintentable(new ErrorApi('tardo', 408)), true)
  assert.equal(esReintentable(new ErrorApi('ocupado', 503)), true)
})

// --- La carga con reintento (lo que usa `useCargaConReintento`) --------------

const { cargarConReintento } = await import('@/lib/api/reintento')

function reintentoEspia() {
  const espia = { programados: 0, exitos: 0 }
  espia.programar = () => {
    espia.programados += 1
  }
  espia.exito = () => {
    espia.exitos += 1
  }
  espia.cancelar = () => {}
  return espia
}

test('una carga que falla por algo pasajero se reintenta', async () => {
  const espia = reintentoEspia()
  await cargarConReintento(async () => {
    throw new ErrorApi('ocupado', 503)
  }, espia, () => {})
  assert.deepEqual([espia.programados, espia.exitos], [1, 0])
})

test('una carga que sale bien reinicia la espera', async () => {
  const espia = reintentoEspia()
  await cargarConReintento(async () => {}, espia, () => {})
  assert.deepEqual([espia.programados, espia.exitos], [0, 1])
})

test('una carga reemplazada por otra mas nueva no cuenta como exito ni como fallo', async () => {
  const espia = reintentoEspia()
  await cargarConReintento(async () => 'reemplazada', espia, () => {})
  assert.deepEqual([espia.programados, espia.exitos], [0, 0])
})

test('un enlace vencido no se reintenta', async () => {
  const espia = reintentoEspia()
  await cargarConReintento(async () => {
    throw new ErrorApi('vencido', 401)
  }, espia, () => {})
  assert.equal(espia.programados, 0)
})

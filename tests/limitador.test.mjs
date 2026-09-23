// El monitor del administrador pedia el dia completo (`historico`) con cada
// rafaga de eventos: en hora pico, varias consultas pesadas por minuto para
// pintar casi lo mismo. El limitador deja pasar como mucho una cada tanto, y
// la ultima peticion del intervalo nunca se pierde: el tablero siempre acaba
// al dia.
import assert from 'node:assert/strict'
import test from 'node:test'

const { crearLimitador } = await import('@/lib/api/limitador')

/** Reloj y temporizadores de mentira: el tiempo avanza cuando la prueba dice. */
function tiempoDePrueba() {
  let ahora = 0
  let tareas = []
  const programar = (accion, ms) => {
    const tarea = { cuando: ahora + ms, accion }
    tareas.push(tarea)
    return () => {
      tareas = tareas.filter((t) => t !== tarea)
    }
  }
  const avanzar = (ms) => {
    ahora += ms
    const vencidas = tareas.filter((t) => t.cuando <= ahora)
    tareas = tareas.filter((t) => t.cuando > ahora)
    for (const t of vencidas) t.accion()
  }
  return { programar, avanzar, reloj: () => ahora }
}

test('la primera peticion pasa en el acto', () => {
  const tiempo = tiempoDePrueba()
  let cargas = 0
  const limitador = crearLimitador(5000, () => (cargas += 1), tiempo)

  limitador.pedir()

  assert.equal(cargas, 1)
})

test('una rafaga dentro del intervalo se junta en UNA carga al final del intervalo', () => {
  const tiempo = tiempoDePrueba()
  let cargas = 0
  const limitador = crearLimitador(5000, () => (cargas += 1), tiempo)

  limitador.pedir()
  tiempo.avanzar(1000)
  limitador.pedir()
  limitador.pedir()
  tiempo.avanzar(1000)
  limitador.pedir()
  assert.equal(cargas, 1, 'nada mas mientras dura el intervalo')

  tiempo.avanzar(3000)
  assert.equal(cargas, 2, 'la ultima peticion no se pierde')
})

test('con eventos sin parar, carga igual cada intervalo: nunca se queda esperando', () => {
  const tiempo = tiempoDePrueba()
  let cargas = 0
  const limitador = crearLimitador(5000, () => (cargas += 1), tiempo)

  for (let ms = 0; ms < 20_000; ms += 500) {
    limitador.pedir()
    tiempo.avanzar(500)
  }

  assert.ok(cargas >= 4, `en 20 s con eventos cada medio segundo cargo ${cargas} veces`)
  assert.ok(cargas <= 5, `y no mas de una cada 5 s (${cargas})`)
})

test('sin peticiones pendientes no carga por su cuenta, y cancelar suelta la pendiente', () => {
  const tiempo = tiempoDePrueba()
  let cargas = 0
  const limitador = crearLimitador(5000, () => (cargas += 1), tiempo)

  limitador.pedir()
  tiempo.avanzar(60_000)
  assert.equal(cargas, 1)

  limitador.pedir()
  limitador.pedir()
  limitador.cancelar()
  tiempo.avanzar(60_000)
  assert.equal(cargas, 2, 'la que se pidio pasado el intervalo va en el acto; la pendiente se cancelo')
})

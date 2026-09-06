// La campana del llamado suena UNA VEZ POR LLAMADO, separando las campanadas
// un segundo entre si.
//
// EL BUG QUE SE PRUEBA AQUI: cuando dos o tres consultorios pasan paciente casi
// al mismo tiempo, sus eventos llegan con milisegundos de diferencia. Sonando
// cada uno en el acto, las campanadas se solapan nota con nota y la sala oye un
// solo sonido; agrupandolas en una sola (como se hacia antes) el resultado es
// el mismo de oido: pasaron tres pacientes y la sala conto uno.
//
// Con la cola, la primera suena ya y cada siguiente espera `MS_SEPARACION`, que
// es mas de lo que dura la campanita (`MS_CAMPANA`): se oyen separadas y se
// pueden contar. El tope `MAX_EN_COLA` evita el extremo contrario, que diez
// consultorios llamando a la vez conviertan el aviso en una alarma larga.
import assert from 'node:assert/strict'
import test from 'node:test'

const { CampanaDeLlamado, MS_CAMPANA, MS_SEPARACION, MAX_EN_COLA } = await import('@/lib/turnos/anuncio')

/**
 * Temporizador falso: la separacion se prueba moviendo el reloj a mano, sin
 * esperar segundos de verdad.
 */
function programadorFalso() {
  let ahora = 0
  let programadas = []

  const programar = (accion, ms) => {
    const tarea = { en: ahora + ms, accion }
    programadas.push(tarea)
    return () => {
      programadas = programadas.filter((t) => t !== tarea)
    }
  }

  const avanzar = (ms) => {
    const destino = ahora + ms

    for (;;) {
      const vencidas = programadas.filter((t) => t.en <= destino).sort((a, b) => a.en - b.en)
      const proxima = vencidas[0]
      if (!proxima) break

      programadas = programadas.filter((t) => t !== proxima)
      ahora = proxima.en
      proxima.accion()
    }

    ahora = destino
  }

  return { programar, avanzar }
}

function campanaDePrueba(separacionMs = MS_SEPARACION) {
  const sonadas = []
  const reloj = programadorFalso()
  const campana = new CampanaDeLlamado((volumen) => sonadas.push(volumen), separacionMs, reloj.programar)
  return { campana, sonadas, reloj }
}

test('la separacion deja terminar la campanita antes de la siguiente', () => {
  // Si se solapan, la sala oye un ruido en vez de dos avisos contables.
  assert.ok(MS_SEPARACION > MS_CAMPANA)
})

test('un llamado suelto suena de inmediato', () => {
  const { campana, sonadas } = campanaDePrueba()

  assert.equal(campana.anunciar(1), 'sono')
  assert.deepEqual(sonadas, [1])
})

test('dos consultorios pasando paciente a la vez suenan LOS DOS', () => {
  const { campana, sonadas, reloj } = campanaDePrueba()

  // Mismo instante: es lo que pasa a primera hora.
  assert.equal(campana.anunciar(1), 'sono')
  assert.equal(campana.anunciar(1), 'en-cola')

  assert.equal(sonadas.length, 1, 'la segunda no se pisa con la primera')

  reloj.avanzar(MS_SEPARACION)
  assert.equal(sonadas.length, 2, 'un segundo despues suena la segunda')
})

test('tres a la vez suenan las tres, una por segundo', () => {
  const { campana, sonadas, reloj } = campanaDePrueba()

  campana.anunciar(1)
  campana.anunciar(1)
  campana.anunciar(1)

  assert.equal(sonadas.length, 1)
  assert.equal(campana.pendientes, 2)

  reloj.avanzar(MS_SEPARACION)
  assert.equal(sonadas.length, 2)

  reloj.avanzar(MS_SEPARACION)
  assert.equal(sonadas.length, 3, 'ningun llamado se quedo sin aviso')
  assert.equal(campana.pendientes, 0)
})

test('la campanada en cola no se adelanta antes de tiempo', () => {
  const { campana, sonadas, reloj } = campanaDePrueba()

  campana.anunciar(1)
  campana.anunciar(1)

  reloj.avanzar(MS_SEPARACION - 1)
  assert.equal(sonadas.length, 1, 'todavia no se cumplio la separacion')

  reloj.avanzar(1)
  assert.equal(sonadas.length, 2)
})

test('pasada la rafaga, un llamado posterior vuelve a sonar en el acto', () => {
  const { campana, sonadas, reloj } = campanaDePrueba()

  campana.anunciar(1)
  campana.anunciar(1)

  // Una separacion para la segunda campanada y otra para que la cola quede
  // libre del todo.
  reloj.avanzar(MS_SEPARACION * 2)
  assert.equal(sonadas.length, 2)

  assert.equal(campana.anunciar(1), 'sono')
  assert.equal(sonadas.length, 3)
})

test('diez consultorios a la vez no convierten el aviso en una alarma', () => {
  const { campana, sonadas, reloj } = campanaDePrueba()

  for (let i = 0; i < 10; i += 1) campana.anunciar(1)

  assert.equal(campana.pendientes, MAX_EN_COLA, 'lo que pasa del tope se descarta')

  reloj.avanzar(MS_SEPARACION * 20)
  assert.equal(sonadas.length, MAX_EN_COLA + 1, 'la que sono ya, mas las de la cola')
})

test('los volumenes llegan al reproductor tal cual y en orden de llegada', () => {
  const { campana, sonadas, reloj } = campanaDePrueba()

  campana.anunciar(0.4)
  campana.anunciar(0.9)

  reloj.avanzar(MS_SEPARACION)
  assert.deepEqual(sonadas, [0.4, 0.9])
})

test('con el volumen en cero no suena nada y no arranca la espera', () => {
  const { campana, sonadas } = campanaDePrueba()

  assert.equal(campana.anunciar(0), 'descartado')
  assert.deepEqual(sonadas, [])

  // La pantalla muda no tiene por que acordarse de nada: si se sube el volumen,
  // el siguiente llamado suena de inmediato.
  assert.equal(campana.anunciar(1), 'sono')
  assert.equal(sonadas.length, 1)
})

test('un fallo de audio no tumba la pantalla ni tranca la cola', () => {
  const reloj = programadorFalso()
  let fallar = true
  const sonadas = []

  const campana = new CampanaDeLlamado(
    (volumen) => {
      if (fallar) throw new Error('audio bloqueado por el navegador')
      sonadas.push(volumen)
    },
    MS_SEPARACION,
    reloj.programar,
  )

  assert.equal(campana.anunciar(1), 'descartado', 'no sono, pero no revienta')

  fallar = false
  reloj.avanzar(MS_SEPARACION * 2)
  assert.equal(campana.anunciar(1), 'sono')
  assert.deepEqual(sonadas, [1])
})

test('reiniciar calla lo que quedaba en cola', () => {
  const { campana, sonadas, reloj } = campanaDePrueba()

  campana.anunciar(1)
  campana.anunciar(1)
  campana.anunciar(1)
  assert.equal(campana.pendientes, 2)

  // Es lo que pasa al pulsar el boton de mudo en la pantalla: lo encolado no
  // puede seguir saliendo por el altavoz.
  campana.reiniciar()

  reloj.avanzar(MS_SEPARACION * 5)
  assert.equal(sonadas.length, 1, 'solo la que ya habia sonado')

  // Y la campana queda lista: el siguiente llamado suena de inmediato.
  assert.equal(campana.anunciar(1), 'sono')
})

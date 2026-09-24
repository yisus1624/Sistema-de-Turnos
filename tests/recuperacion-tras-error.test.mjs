// Las pantallas que no pueden quedarse en blanco se recuperan solas de un error.
//
// Sin limite de errores, una excepcion al pintar dejaba "Application error"
// para siempre. En el televisor de la sala de espera no hay nadie delante que
// recargue: la sala se quedaba sin turnos. Ahora el aviso de error vuelve a
// pintar la pantalla solo y, en el televisor, si a los ~30 s sigue rota, la
// recarga entera... pero solo si el servidor contesta: recargar con el
// servidor caido deja la pagina de error del navegador, que no vuelve sola.
import assert from 'node:assert/strict'
import test from 'node:test'

const { crearRachaDeFallos, programarRecuperacion, paginaResponde } = await import('@/lib/api/recuperacion')

/** Un reloj de mentira: se avanza a mano y dispara en orden lo que venza. */
function relojDePrueba() {
  let ahora = 0
  const pendientes = []
  const reloj = {
    ahora: () => ahora,
    programar(accion, ms) {
      const entrada = { accion, en: ahora + ms, cancelada: false }
      pendientes.push(entrada)
      return () => {
        entrada.cancelada = true
      }
    },
    /** Las esperas que siguen programadas, en ms desde ahora. */
    esperasVivas: () => pendientes.filter((p) => !p.cancelada).map((p) => p.en - ahora),
    async avanzar(ms) {
      const hasta = ahora + ms
      for (;;) {
        const vence = pendientes.filter((p) => !p.cancelada && p.en <= hasta).sort((a, b) => a.en - b.en)[0]
        if (!vence) break
        vence.cancelada = true
        ahora = vence.en
        vence.accion()
        // Deja terminar lo asincrono (la pregunta al servidor).
        await new Promise((listo) => setImmediate(listo))
      }
      ahora = hasta
    },
  }
  return reloj
}

/** Espera sin azar: 1 s, 2 s, 4 s... */
const esperaFija = (intento) => 1000 * 2 ** intento

/**
 * Monta el aviso de error como lo hace React: cada reintento que vuelve a
 * fallar DESMONTA el aviso y monta uno nuevo, con la misma racha.
 */
function pantallaQueSigueRota({ reloj, racha, recarga }) {
  const registro = { reintentos: 0, recargas: 0 }
  let cancelarActual = () => {}
  const montar = () => {
    cancelarActual = programarRecuperacion({
      racha,
      reintentar: () => {
        registro.reintentos += 1
        cancelarActual()
        montar()
      },
      recarga: recarga && {
        ...recarga,
        recargar: () => {
          registro.recargas += 1
        },
      },
      programar: reloj.programar,
      ahora: reloj.ahora,
      espera: esperaFija,
    })
  }
  montar()
  return { registro, desmontar: () => cancelarActual() }
}

test('tras romperse, vuelve a pintar la pantalla sola', async () => {
  const reloj = relojDePrueba()
  let reintentos = 0
  programarRecuperacion({
    racha: crearRachaDeFallos(),
    reintentar: () => {
      reintentos += 1
    },
    programar: reloj.programar,
    ahora: reloj.ahora,
    espera: esperaFija,
  })

  await reloj.avanzar(999)
  assert.equal(reintentos, 0)
  await reloj.avanzar(1)
  assert.equal(reintentos, 1)
})

test('la racha sobrevive a que React vuelva a montar el aviso: cada reintento espera mas', () => {
  const reloj = relojDePrueba()
  const racha = crearRachaDeFallos()
  const opciones = { racha, reintentar: () => {}, programar: reloj.programar, ahora: reloj.ahora, espera: esperaFija }

  const primero = programarRecuperacion(opciones)
  assert.deepEqual(reloj.esperasVivas(), [1000])
  primero()

  programarRecuperacion(opciones)
  assert.deepEqual(reloj.esperasVivas(), [2000], 'el segundo montaje es el segundo intento, no el primero')
})

test('el televisor se recarga a los 30 s del PRIMER fallo, aunque el aviso se haya montado varias veces', async () => {
  const reloj = relojDePrueba()
  const { registro } = pantallaQueSigueRota({
    reloj,
    racha: crearRachaDeFallos(),
    recarga: { trasMs: 30_000, servidorResponde: async () => true },
  })

  await reloj.avanzar(29_999)
  assert.ok(registro.reintentos >= 3, 'antes de recargar, reintento en su sitio')
  assert.equal(registro.recargas, 0)

  await reloj.avanzar(1)
  assert.equal(registro.recargas, 1)
})

test('con el servidor caido no recarga: vuelve a preguntar un poco despues', async () => {
  const reloj = relojDePrueba()
  let responde = false
  const { registro } = pantallaQueSigueRota({
    reloj,
    racha: crearRachaDeFallos(),
    recarga: { trasMs: 30_000, servidorResponde: async () => responde },
  })

  await reloj.avanzar(45_000)
  assert.equal(registro.recargas, 0, 'recargar ahora dejaria la pagina de error del navegador')

  responde = true
  await reloj.avanzar(60_000)
  assert.equal(registro.recargas, 1)
})

test('una pregunta al servidor que falla cuenta como que no contesta', async () => {
  const reloj = relojDePrueba()
  const { registro } = pantallaQueSigueRota({
    reloj,
    racha: crearRachaDeFallos(),
    recarga: {
      trasMs: 30_000,
      servidorResponde: async () => {
        throw new Error('sin red')
      },
    },
  })

  await reloj.avanzar(40_000)
  assert.equal(registro.recargas, 0)
})

test('sin recarga (el consultorio) solo reintenta, nunca recarga', async () => {
  const reloj = relojDePrueba()
  const { registro } = pantallaQueSigueRota({ reloj, racha: crearRachaDeFallos() })

  await reloj.avanzar(10 * 60_000)
  assert.ok(registro.reintentos > 0)
  assert.equal(registro.recargas, 0)
})

test('si la pantalla se recupera (se desmonta el aviso) no queda nada programado', async () => {
  const reloj = relojDePrueba()
  let respuestaDelServidor
  const { registro, desmontar } = pantallaQueSigueRota({
    reloj,
    racha: crearRachaDeFallos(),
    recarga: {
      trasMs: 30_000,
      servidorResponde: () =>
        new Promise((resolver) => {
          respuestaDelServidor = resolver
        }),
    },
  })

  await reloj.avanzar(30_000)
  assert.ok(respuestaDelServidor, 'ya pregunto al servidor')
  const reintentosAlRecuperarse = registro.reintentos
  desmontar()
  respuestaDelServidor(true)
  await new Promise((listo) => setImmediate(listo))
  await reloj.avanzar(10 * 60_000)

  assert.equal(registro.recargas, 0, 'la respuesta que llega tarde no recarga una pantalla que ya volvio')
  assert.equal(registro.reintentos, reintentosAlRecuperarse)
  assert.deepEqual(reloj.esperasVivas(), [])
})

test('un fallo mucho despues empieza una racha nueva', () => {
  const racha = crearRachaDeFallos()

  assert.deepEqual(racha.anotar(0), { intento: 0, msDesdeElPrimero: 0 })
  assert.deepEqual(racha.anotar(5_000), { intento: 1, msDesdeElPrimero: 5_000 })
  assert.deepEqual(racha.anotar(60 * 60_000), { intento: 0, msDesdeElPrimero: 0 })
})

// --- La pregunta al servidor ---------------------------------------------------

async function conFetch(falso, prueba) {
  const original = globalThis.fetch
  globalThis.fetch = falso
  try {
    await prueba()
  } finally {
    globalThis.fetch = original
  }
}

test('el servidor contesta si la pagina responde 200', async () => {
  let pedida
  await conFetch(
    async (url, opciones) => {
      pedida = { url, metodo: opciones.method, cache: opciones.cache }
      return new Response(null, { status: 200 })
    },
    async () => assert.equal(await paginaResponde('http://localhost/pantalla'), true),
  )
  assert.deepEqual(pedida, { url: 'http://localhost/pantalla', metodo: 'HEAD', cache: 'no-store' })
})

test('un 502 de nginx (servidor reiniciando) o un 429 no cuentan como que contesta', async () => {
  for (const status of [502, 503, 429]) {
    await conFetch(
      async () => new Response(null, { status }),
      async () => assert.equal(await paginaResponde('http://localhost/pantalla'), false, String(status)),
    )
  }
})

test('sin red no contesta, y una pregunta colgada se abandona', async () => {
  await conFetch(
    async () => {
      throw new TypeError('Failed to fetch')
    },
    async () => assert.equal(await paginaResponde('http://localhost/pantalla'), false),
  )
  await conFetch(
    (_url, opciones) =>
      new Promise((_resolver, rechazar) => {
        opciones.signal.addEventListener('abort', () => rechazar(new DOMException('abortada', 'AbortError')))
      }),
    async () => assert.equal(await paginaResponde('http://localhost/pantalla', 20), false),
  )
})

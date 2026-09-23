// El canal en vivo (SSE) es PUBLICO y no pide sesion: lo consume el televisor
// de la sala de espera.
//
// Cada conexion cuesta un listener en el hub y un temporizador de latido que
// no se apaga solo. Sin tope, un bucle de peticiones desde cualquier equipo de
// la red deja al servidor sin memoria ni descriptores, y lo primero que se cae
// es justo la pantalla de la sala de espera y los consultorios, que viven de
// este canal. `setMaxListeners` no limita nada: solo calla el aviso de Node.
//
// Estas pruebas fijan el comportamiento del aforo: se admite hasta el tope, se
// rechaza despues, y la plaza se libera UNA sola vez aunque se suelte dos
// veces (la conexion se cierra por `cancel()` y ademas por el `limpiar()` que
// corre cuando falla un envio).
import assert from 'node:assert/strict'
import test from 'node:test'

const { conexionesActivas, ocuparPlaza } = await import('@/lib/realtime/aforo')

/** Deja el aforo vacio: las pruebas comparten el contador global del proceso. */
function soltarTodas(plazas) {
  for (const plaza of plazas) plaza.soltar()
}

test('admite conexiones hasta el tope y rechaza la siguiente', () => {
  process.env.TURNOS_MAX_CANAL_EN_VIVO = '3'
  const plazas = []

  for (let i = 0; i < 3; i += 1) {
    const resultado = ocuparPlaza(null)
    assert.equal(resultado.admitida, true)
    if (resultado.admitida) plazas.push(resultado.plaza)
  }

  const rechazada = ocuparPlaza(null)
  assert.equal(rechazada.admitida, false)
  assert.equal(rechazada.motivo, 'aforo_global')
  assert.equal(conexionesActivas(), 3)

  soltarTodas(plazas)
  assert.equal(conexionesActivas(), 0)
  delete process.env.TURNOS_MAX_CANAL_EN_VIVO
})

test('soltar la misma plaza dos veces no descuenta dos veces', () => {
  process.env.TURNOS_MAX_CANAL_EN_VIVO = '2'

  const primera = ocuparPlaza(null)
  const segunda = ocuparPlaza(null)
  assert.equal(primera.admitida && segunda.admitida, true)

  primera.plaza.soltar()
  primera.plaza.soltar()

  // Si el doble descuento contara, aqui habria 0 y el aforo admitiria una
  // conexion de mas por cada pantalla que se cierra: el tope se volveria
  // decorativo con el paso de las horas.
  assert.equal(conexionesActivas(), 1)

  segunda.plaza.soltar()
  assert.equal(conexionesActivas(), 0)
  delete process.env.TURNOS_MAX_CANAL_EN_VIVO
})

test('con proxy declarado tambien limita por origen', () => {
  process.env.TURNOS_MAX_CANAL_EN_VIVO = '50'
  process.env.TURNOS_MAX_CANAL_EN_VIVO_POR_ORIGEN = '2'
  const plazas = []

  for (let i = 0; i < 2; i += 1) {
    const resultado = ocuparPlaza('10.0.0.7')
    assert.equal(resultado.admitida, true)
    if (resultado.admitida) plazas.push(resultado.plaza)
  }

  const rechazada = ocuparPlaza('10.0.0.7')
  assert.equal(rechazada.admitida, false)
  assert.equal(rechazada.motivo, 'aforo_por_origen')

  // Otro equipo del hospital NO paga el exceso del primero.
  const otra = ocuparPlaza('10.0.0.8')
  assert.equal(otra.admitida, true)
  if (otra.admitida) plazas.push(otra.plaza)

  soltarTodas(plazas)
  assert.equal(conexionesActivas(), 0)
  delete process.env.TURNOS_MAX_CANAL_EN_VIVO
  delete process.env.TURNOS_MAX_CANAL_EN_VIVO_POR_ORIGEN
})

test('el conteo por origen se olvida cuando ese origen se va del todo', () => {
  process.env.TURNOS_MAX_CANAL_EN_VIVO_POR_ORIGEN = '1'

  const primera = ocuparPlaza('10.0.0.9')
  assert.equal(primera.admitida, true)
  if (primera.admitida) primera.plaza.soltar()

  // Sin olvidar el origen, el mapa crecería con cada IP que alguna vez se
  // conecto: la misma fuga que se esta cerrando, por otra puerta.
  const segunda = ocuparPlaza('10.0.0.9')
  assert.equal(segunda.admitida, true)
  if (segunda.admitida) segunda.plaza.soltar()

  assert.equal(conexionesActivas(), 0)
  delete process.env.TURNOS_MAX_CANAL_EN_VIVO_POR_ORIGEN
})

test('el rechazo se anota con freno: la avalancha no se convierte en escrituras', async () => {
  const { tocaAnotarElRechazo } = await import('@/lib/realtime/aforo')

  const anotados = [tocaAnotarElRechazo(), tocaAnotarElRechazo(), tocaAnotarElRechazo()]

  // El primero deja constancia —que es lo que necesita quien audita—; los que
  // vienen detras en la misma rafaga no vuelven a escribir en la base.
  assert.deepEqual(anotados, [true, false, false])
})

// ---------------------------------------------------------------------------
// Todo el hospital detras de UNA IP cualquiera, sin configurar nada.
//
// El servidor esta en internet y los equipos del hospital salen por el mismo
// NAT, con una IP que el proveedor cambia cuando quiere. No se le puede pedir
// esa IP a nadie: los topes por defecto tienen que admitir ~30 pantallas y la
// reconexion masiva tras un corte (las conexiones viejas siguen contando hasta
// que el reciclado de 4-6 minutos las suelta), y aun asi frenar a una IP que
// abre cientos de conexiones.
// ---------------------------------------------------------------------------

/** Ocupa `cuantas` plazas desde `origen` y devuelve lo que paso con cada una. */
function conectar(origen, cuantas) {
  return Array.from({ length: cuantas }, () => ocuparPlaza(origen))
}

function plazasDe(resultados) {
  return resultados.filter((r) => r.admitida).map((r) => r.plaza)
}

function conTopesPorDefecto(prueba) {
  delete process.env.TURNOS_MAX_CANAL_EN_VIVO
  delete process.env.TURNOS_MAX_CANAL_EN_VIVO_POR_ORIGEN
  prueba()
}

const UNA_IP_CUALQUIERA = '181.52.13.77'

test('30 pantallas detras de una misma IP entran sin configurar nada', () => {
  conTopesPorDefecto(() => {
    const resultados = conectar(UNA_IP_CUALQUIERA, 30)

    assert.equal(resultados.every((r) => r.admitida), true)
    soltarTodas(plazasDe(resultados))
    assert.equal(conexionesActivas(), 0)
  })
})

test('tras un corte, las 30 reconectan aunque las 30 viejas sigan colgadas', () => {
  conTopesPorDefecto(() => {
    const colgadas = conectar(UNA_IP_CUALQUIERA, 30)
    const reconexiones = conectar(UNA_IP_CUALQUIERA, 30)

    assert.equal(reconexiones.every((r) => r.admitida), true, 'ninguna pantalla se queda fuera')
    soltarTodas([...plazasDe(colgadas), ...plazasDe(reconexiones)])
  })
})

test('una IP que abre cientos de conexiones queda topada', () => {
  conTopesPorDefecto(() => {
    const resultados = conectar('203.0.113.66', 300)
    const rechazadas = resultados.filter((r) => !r.admitida)

    assert.equal(plazasDe(resultados).length, 100, 'tope por IP por defecto')
    assert.equal(rechazadas[0].motivo, 'aforo_por_origen')
    soltarTodas(plazasDe(resultados))
  })
})

test('tres IPs atacantes con su tope lleno no dejan a la sala sin pantalla', () => {
  conTopesPorDefecto(() => {
    const atacantes = [1, 2, 3].flatMap((n) => conectar(`203.0.113.${n}`, 100))
    const sala = conectar(UNA_IP_CUALQUIERA, 30)

    assert.equal(sala.every((r) => r.admitida), true)
    soltarTodas([...plazasDe(atacantes), ...plazasDe(sala)])
  })
})

test('el tope global protege la memoria aunque cada IP este dentro de su tope', () => {
  conTopesPorDefecto(() => {
    const resultados = Array.from({ length: 25 }, (_, n) => n).flatMap((n) => conectar(`198.51.100.${n}`, 90))
    const rechazadas = resultados.filter((r) => !r.admitida)

    assert.equal(plazasDe(resultados).length, 2000, 'tope global por defecto')
    assert.equal(rechazadas[0].motivo, 'aforo_global')
    soltarTodas(plazasDe(resultados))
    assert.equal(conexionesActivas(), 0)
  })
})

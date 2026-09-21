// Cifrado de los secretos que el servidor necesita poder volver a leer.
//
// Hoy lo usa una sola cosa: la copia recuperable del enlace de consultorio. Lo
// que se prueba aqui es que sea cifrado de verdad y no una ofuscacion: que el
// texto guardado no contenga el original, que dos cifrados del mismo texto
// salgan distintos (si no, se puede saber que dos doctores tienen el mismo
// enlace sin descifrar nada) y que un texto manipulado falle en vez de
// devolver basura.
import assert from 'node:assert/strict'
import test from 'node:test'

// La clave sale del entorno; en las pruebas se pone una fija.
process.env.TURNOS_CLAVE_SECRETOS = 'clave-de-pruebas-no-usar-en-produccion'

const { cifrar, descifrar } = await import('@/lib/seguridad/cifrado')

const ENLACE = 'zk3Jd8s_QpX1r4Tn6vYb2LwM9cHgF0eA5iOu7RtK-Es'

test('lo cifrado se vuelve a leer igual', () => {
  assert.equal(descifrar(cifrar(ENLACE)), ENLACE)
})

test('el texto guardado no contiene el original', () => {
  assert.equal(cifrar(ENLACE).includes(ENLACE), false)
})

test('cifrar dos veces lo mismo da resultados distintos', () => {
  // Cada cifrado lleva su propio vector de inicializacion. Sin esto, dos filas
  // iguales en la tabla delatarian que guardan el mismo secreto.
  assert.notEqual(cifrar(ENLACE), cifrar(ENLACE))
})

test('un texto manipulado no se descifra: devuelve null', () => {
  /*
    SE MANIPULA UN BYTE, NO UN CARACTER DEL BASE64.

    La primera version cambiaba el penultimo caracter del texto guardado, y era
    una prueba inestable: nuestro cifrado mide 71 bytes (12 del vector + 16 de
    la etiqueta + 43 del cuerpo), un tamaño que en base64 deja dos bits de
    relleno que no significan nada. Cuando el cambio caia justo en esos bits,
    el texto decodificaba EXACTAMENTE a los mismos bytes, el descifrado
    funcionaba y la prueba fallaba. Medido: 39 de cada 500 intentos, o sea que
    reventaba mas o menos una de cada trece ejecuciones.

    Tocando el buffer decodificado no hay ambiguedad posible: el byte cambia
    siempre, y AES-GCM tiene que rechazarlo por la etiqueta de autenticacion.
  */
  const bytes = Buffer.from(cifrar(ENLACE), 'base64')

  // Un byte del cuerpo, pasados el vector de inicializacion y la etiqueta.
  bytes[30] = bytes[30] ^ 0xff

  assert.equal(descifrar(bytes.toString('base64')), null)
})

test('manipular la etiqueta de autenticacion tampoco cuela', () => {
  // La etiqueta es lo que hace que esto sea cifrado autenticado y no solo
  // cifrado: sin comprobarla, alguien podria cambiar el contenido y el sistema
  // devolveria basura creyendola buena.
  const bytes = Buffer.from(cifrar(ENLACE), 'base64')
  bytes[12] = bytes[12] ^ 0xff

  assert.equal(descifrar(bytes.toString('base64')), null)
})

test('basura que no es un cifrado devuelve null en vez de reventar', () => {
  assert.equal(descifrar('esto-no-es-nada'), null)
  assert.equal(descifrar(''), null)
})

test('con otra clave no se puede leer', () => {
  const guardado = cifrar(ENLACE)

  process.env.TURNOS_CLAVE_SECRETOS = 'otra-clave-distinta'
  try {
    assert.equal(descifrar(guardado), null)
  } finally {
    process.env.TURNOS_CLAVE_SECRETOS = 'clave-de-pruebas-no-usar-en-produccion'
  }
})

// ---------------------------------------------------------------------------
// LA COPIA RECUPERABLE ES UNA COMODIDAD, NO PUEDE SER UN PUNTO DE FALLO
// ---------------------------------------------------------------------------

const { cifrarSiSePuede } = await import('@/lib/seguridad/cifrado')

test('sin secreto configurado, cifrar no revienta: devuelve null', async (t) => {
  // Escenario real: se despliega con el entorno incompleto, o se rota el
  // secreto a medias. Si esto lanzara, la transaccion que genera el enlace se
  // caeria entera y NINGUN doctor podria obtener el suyo, aunque la validacion
  // por hash —que es lo que de verdad abre el consultorio— no dependa de esto.
  t.mock.method(console, 'error', () => {})

  const previos = {
    propio: process.env.TURNOS_CLAVE_SECRETOS,
    auth: process.env.AUTH_SECRET,
    nextauth: process.env.NEXTAUTH_SECRET,
  }
  delete process.env.TURNOS_CLAVE_SECRETOS
  delete process.env.AUTH_SECRET
  delete process.env.NEXTAUTH_SECRET

  try {
    assert.equal(cifrarSiSePuede(ENLACE), null)
  } finally {
    if (previos.propio !== undefined) process.env.TURNOS_CLAVE_SECRETOS = previos.propio
    if (previos.auth !== undefined) process.env.AUTH_SECRET = previos.auth
    if (previos.nextauth !== undefined) process.env.NEXTAUTH_SECRET = previos.nextauth
  }
})

test('con secreto, cifrarSiSePuede cifra como siempre', () => {
  process.env.TURNOS_CLAVE_SECRETOS = 'clave-de-pruebas-no-usar-en-produccion'
  const guardado = cifrarSiSePuede(ENLACE)
  assert.ok(guardado)
  assert.equal(descifrar(guardado), ENLACE)
})

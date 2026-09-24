// El limite de intentos de entrada, con todo el hospital detras de una IP.
//
// Se cuentan SOLO FALLOS, y por capas:
//   - por cuenta Y origen (8): quien prueba contrasenas contra una cuenta desde
//     una IP la deja en espera EN ESA IP; el dueño desde el hospital sigue
//     entrando. Antes la espera iba solo por cuenta, y una IP externa dejo en
//     espera a 33 de 35 cuentas del hospital.
//   - por cuenta (50): contra un ataque repartido entre muchas IPs.
//   - por IP (300): contra quien prueba cientos de cuentas. El acierto de OTRA
//     cuenta ya no lo borra: con una cuenta valida se podian probar miles.
import assert from 'node:assert/strict'
import test from 'node:test'

const {
  frenoDeIngreso,
  apuntarFalloDeIngreso,
  olvidarFallosDeIngreso,
  retardoDeIngresoMs,
  MS_TOPE_RETARDO_INGRESO,
  FALLOS_POR_CUENTA_Y_ORIGEN,
  FALLOS_POR_CUENTA,
  FALLOS_POR_ORIGEN,
} = await import('@/lib/seguridad/limite-ingreso')

const IP_DEL_HOSPITAL = '181.52.13.77'

function fallar(usuario, ip, veces) {
  for (let i = 0; i < veces; i += 1) apuntarFalloDeIngreso(usuario, ip)
}

test('mirar el freno no gasta cupo: un uso normal no acerca a nadie a la espera', () => {
  for (let i = 0; i < 100; i += 1) assert.equal(frenoDeIngreso('mira-mucho', IP_DEL_HOSPITAL), 'permitido')
})

test('25 funcionarios equivocandose desde la misma IP no se bloquean entre si', () => {
  for (let n = 1; n <= 25; n += 1) fallar(`funcionario${n}`, IP_DEL_HOSPITAL, 3)

  for (let n = 1; n <= 25; n += 1) assert.equal(frenoDeIngreso(`funcionario${n}`, IP_DEL_HOSPITAL), 'permitido')
})

test('una cuenta atacada desde fuera queda en espera ALLI, y su dueño sigue entrando desde el hospital', () => {
  fallar('atacada', '203.0.113.5', FALLOS_POR_CUENTA_Y_ORIGEN)

  assert.equal(frenoDeIngreso('atacada', '203.0.113.5'), 'cuenta_en_espera')
  assert.equal(frenoDeIngreso('atacada', IP_DEL_HOSPITAL), 'permitido')
})

test('un ataque repartido entre muchas IPs pone la cuenta en espera en todas partes', () => {
  for (let n = 0; n < FALLOS_POR_CUENTA; n += 1) apuntarFalloDeIngreso('repartida', `198.51.100.${n}`)

  assert.equal(frenoDeIngreso('repartida', IP_DEL_HOSPITAL), 'cuenta_en_espera')
})

test('una IP que prueba cientos de cuentas queda frenada, y el acierto de otra cuenta no la libera', () => {
  const ip = '203.0.113.99'
  for (let n = 0; n < FALLOS_POR_ORIGEN; n += 1) apuntarFalloDeIngreso(`cuenta-al-azar-${n}`, ip)
  olvidarFallosDeIngreso('cuenta-valida-del-atacante', ip)

  assert.equal(frenoDeIngreso('otra-cuenta-mas', ip), 'origen_en_espera')
})

test('entrar bien borra los fallos de esa cuenta en ese origen', () => {
  fallar('distraido', '198.51.100.200', FALLOS_POR_CUENTA_Y_ORIGEN - 1)
  olvidarFallosDeIngreso('distraido', '198.51.100.200')
  fallar('distraido', '198.51.100.200', FALLOS_POR_CUENTA_Y_ORIGEN - 1)

  assert.equal(frenoDeIngreso('distraido', '198.51.100.200'), 'permitido')
})

test('sin IP de fiar, los fallos de un extraño no bloquean la cuenta: la frenan con espera creciente', () => {
  fallar('sin-ip', null, FALLOS_POR_CUENTA_Y_ORIGEN)
  assert.equal(frenoDeIngreso('sin-ip', null), 'permitido')
  const espera = retardoDeIngresoMs('sin-ip', null)
  assert.ok(espera > 0)
  fallar('sin-ip', null, 1)
  assert.ok(retardoDeIngresoMs('sin-ip', null) > espera)
})

test('la espera sin IP de fiar tiene tope y se borra al entrar bien', () => {
  fallar('tope', null, FALLOS_POR_CUENTA - 1)
  assert.equal(retardoDeIngresoMs('tope', null), MS_TOPE_RETARDO_INGRESO)
  olvidarFallosDeIngreso('tope', null)
  assert.equal(retardoDeIngresoMs('tope', null), 0)
})

test('con IP de fiar no hay espera: manda el bloqueo por origen', () => {
  fallar('con-ip', '203.0.113.9', 3)
  assert.equal(retardoDeIngresoMs('con-ip', '203.0.113.9'), 0)
})

test('sin IP de fiar sigue el bloqueo por cuenta ante el ataque masivo', () => {
  fallar('masiva', null, FALLOS_POR_CUENTA)
  assert.equal(frenoDeIngreso('masiva', null), 'cuenta_en_espera')
})

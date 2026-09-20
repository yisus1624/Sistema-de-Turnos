// El limitador de intentos no puede ser el agujero por el que se tumbe el
// servidor.
//
// `limitarIntentos` guarda una entrada por identificador, y en el acceso del
// consultorio el identificador es EL TOKEN (`lib/turnos/acceso-consultorio.ts`).
// Asi que cada token inventado que alguien mande a /api/consultorio/<token>
// crea una entrada nueva con ventana de cinco minutos, y la purga solo borra
// las YA vencidas. Un bucle de tokens al azar llena la memoria del proceso sin
// tope: el que se queda sin servidor es el hospital entero, pantalla de sala de
// espera incluida.
//
// Aqui se fija que el mapa tiene techo. Se mira por `globalThis.__turnosIntentos`
// —el mismo sitio donde el modulo lo guarda para sobrevivir al HMR— porque el
// tamaño del mapa no se asoma por ninguna funcion, y añadir una solo para las
// pruebas ensancharia el contrato del modulo sin que nadie mas lo use.
import assert from 'node:assert/strict'
import test from 'node:test'

const { MAXIMO_INTENTOS_EN_MEMORIA, limitarIntentos } = await import('@/lib/seguridad/registro')

const VENTANA_MS = 5 * 60 * 1000

test('el mapa de intentos no crece sin limite aunque lluevan identificadores nuevos', () => {
  const intentos = globalThis.__turnosIntentos
  assert.ok(intentos instanceof Map)

  // Un poco por encima del tope: es justo lo que hace quien prueba tokens al
  // azar contra el enlace del consultorio.
  const avalancha = MAXIMO_INTENTOS_EN_MEMORIA + 5_000

  for (let i = 0; i < avalancha; i += 1) {
    limitarIntentos('token_consultorio', `token-inventado-${i}`, 30, VENTANA_MS)
  }

  assert.ok(
    intentos.size <= MAXIMO_INTENTOS_EN_MEMORIA,
    `el mapa llego a ${intentos.size} entradas, por encima del tope ${MAXIMO_INTENTOS_EN_MEMORIA}`,
  )
})

test('el limite sigue contando fallos despues de hacer sitio', () => {
  // Lo que no puede pasar es que, por poner el techo, el limitador deje de
  // limitar: el tope protege la memoria, no afloja la proteccion.
  for (let i = 0; i < 3; i += 1) {
    const resultado = limitarIntentos('prueba_tope', 'mismo-identificador', 3, VENTANA_MS)
    assert.equal(resultado.permitido, true)
  }

  const cuarto = limitarIntentos('prueba_tope', 'mismo-identificador', 3, VENTANA_MS)
  assert.equal(cuarto.permitido, false)
  assert.ok(cuarto.reintentarEnSegundos > 0)
})

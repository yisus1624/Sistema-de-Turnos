// Lo que el sistema le cuenta al funcionario cuando algo falla.
//
// POR QUE HACE FALTA FIJARLO. Las respuestas de error devolvian `error.message`
// de CUALQUIER excepcion. Con un fallo de Prisma —conexion caida, choque contra
// un indice— eso acababa pintado tal cual en el aviso rojo del mostrador: un
// volcado en ingles con nombres de tabla, de columna y rutas del servidor. No le
// dice nada a quien lo lee y le cuenta de mas a cualquiera que este delante.
//
// Se corrigio en `apiError`, pero `errorConsultorio` tenia su propia copia de la
// misma logica y se quedo sin corregir: sobrevivio seis tandas de saneamiento y
// lo encontro la auditoria final, en la unica puerta del sistema que no pasa por
// usuario y contrasena. Esa es exactamente la clase de regresion que una prueba
// evita, asi que aqui quedan fijadas LAS DOS.
import assert from 'node:assert/strict'
import test from 'node:test'

const { apiError } = await import('@/lib/permissions/session')
const { errorConsultorio, AccesoInvalidoError } = await import('@/lib/turnos/acceso-consultorio')
const { ErrorDeNegocio } = await import('@/lib/turnos/errores')

/** Un fallo tecnico tipico: el texto que de verdad devuelve Prisma. */
function falloDePrisma() {
  return new Error(
    'Invalid `prisma.turno.update()` invocation:\n' +
      'Unique constraint failed on the fields: (`moduloId`,`fecha`)\n' +
      '    at /app/lib/turnos/prisma-repository.ts:812',
  )
}

const cuerpo = async (respuesta) => respuesta.json()

// ---------------------------------------------------------------------------
// Lo que NO puede salir
// ---------------------------------------------------------------------------

for (const [nombre, responder] of [
  ['apiError', apiError],
  ['errorConsultorio', errorConsultorio],
]) {
  test(`${nombre}: un fallo tecnico no le muestra al funcionario las tripas del sistema`, async () => {
    const respuesta = responder(falloDePrisma())
    const { error } = await cuerpo(respuesta)

    assert.equal(respuesta.status, 500)
    assert.equal(error.includes('prisma'), false, 'ni el nombre del cliente de base de datos')
    assert.equal(error.includes('moduloId'), false, 'ni el nombre de una columna')
    assert.equal(error.includes('Unique constraint'), false, 'ni el texto del motor')
    assert.equal(error.includes('.ts:'), false, 'ni una ruta del servidor')
    assert.ok(error.length > 0, 'pero si algo que el funcionario pueda leer')
  })

  test(`${nombre}: un error sin forma conocida tampoco se reenvia`, async () => {
    const respuesta = responder('se rompio algo raro')
    assert.equal(respuesta.status, 500)
  })
}

// ---------------------------------------------------------------------------
// Lo que SI tiene que salir
// ---------------------------------------------------------------------------
//
// Tapar los 500 no puede haberse llevado por delante los mensajes escritos PARA
// el funcionario: si "Ya existe ese consultorio" se vuelve "problema del
// sistema", el aviso deja de decir que hacer y el arreglo habria sido peor que
// el fallo.

for (const [nombre, responder] of [
  ['apiError', apiError],
  ['errorConsultorio', errorConsultorio],
]) {
  test(`${nombre}: un error de negocio llega entero, con su texto en español`, async () => {
    const respuesta = responder(new ErrorDeNegocio('El prefijo C ya lo usa otro servicio.'))
    const { error } = await cuerpo(respuesta)

    assert.equal(respuesta.status, 400)
    assert.equal(error, 'El prefijo C ya lo usa otro servicio.')
  })

  test(`${nombre}: un rechazo de permisos llega entero`, async () => {
    const respuesta = responder(
      Object.assign(new Error('Sin permisos para esta accion'), { status: 403 }),
    )
    const { error } = await cuerpo(respuesta)

    assert.equal(respuesta.status, 403)
    assert.equal(error, 'Sin permisos para esta accion')
  })
}

test('el enlace invalido del consultorio sigue teniendo su propio mensaje', async () => {
  // Es el caso que `errorConsultorio` existe para tratar: un 401 escrito para el
  // doctor, que no distingue si el enlace no existe, vencio o lo revocaron.
  const respuesta = errorConsultorio(new AccesoInvalidoError())
  const { error } = await cuerpo(respuesta)

  assert.equal(respuesta.status, 401)
  assert.match(error, /enlace/i)
  assert.match(error, /sistemas/i, 'y le dice a donde ir a pedir uno nuevo')
})

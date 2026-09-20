// La pantalla publica es la ruta mas pedida del sistema y baja a la base en
// cada peticion. El pool de Prisma que usa es el MISMO del inicio de sesion:
// un bucle de peticiones contra ella no solo apaga el televisor de la sala de
// espera, tambien deja al hospital sin poder entrar a trabajar.
//
// La cache corta lo evita, pero tiene una condicion que no se puede romper: la
// pantalla NO puede enterarse tarde de un llamado. Cuando llega el llamado de
// un consultorio que todavia no esta en la cuadricula, `app/pantalla/page.tsx`
// pide el estado completo en ese instante; si se le sirviera una foto anterior
// al llamado, la sala oiria la campana y no veria el turno.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RAIZ = path.resolve(import.meta.dirname, '..')
const comoUrl = (relativa) => pathToFileURL(path.join(RAIZ, relativa)).href

let consultas = 0
let casillaActual = 'A-001'

mock.module(comoUrl('lib/turnos/repositorio.ts'), {
  namedExports: {
    turnoRepository: {
      async estadoPantalla() {
        consultas += 1
        return { casillas: [{ codigo: casillaActual }], configuracion: {} }
      },
    },
  },
})

const { realtimeHub } = await import('@/lib/realtime/hub')
const { estadoPantallaCacheado } = await import('@/lib/turnos/pantalla-cacheada')

test('una rafaga de peticiones baja a la base una sola vez', async () => {
  consultas = 0

  const respuestas = await Promise.all([
    estadoPantallaCacheado(),
    estadoPantallaCacheado(),
    estadoPantallaCacheado(),
  ])

  assert.equal(consultas, 1)
  for (const respuesta of respuestas) {
    assert.equal(respuesta.casillas[0].codigo, 'A-001')
  }
})

test('un evento del canal tira la foto guardada: el llamado no llega tarde', async () => {
  // Se parte de una foto recien tomada (la prueba anterior dejo una guardada).
  await estadoPantallaCacheado()
  consultas = 0

  casillaActual = 'B-014'
  realtimeHub.publish({ tipo: 'modulo.liberado', moduloId: 'mod-1' })

  const despues = await estadoPantallaCacheado()
  assert.equal(consultas, 1, 'tras un evento hay que volver a preguntar, no servir la foto vieja')
  assert.equal(despues.casillas[0].codigo, 'B-014')
})

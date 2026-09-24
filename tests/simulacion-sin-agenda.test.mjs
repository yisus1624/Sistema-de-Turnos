// Quien solo tiene "Simulacion de carga" no gestiona la agenda real: solo
// puede LEER el horario del dia, que es lo que la simulacion necesita.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const RUTAS_QUE_CAMBIAN_LA_AGENDA = [
  'app/api/turnos/agenda/route.ts',
  'app/api/turnos/agenda/[id]/route.ts',
  'app/api/turnos/citas/llegada/route.ts',
]

for (const ruta of RUTAS_QUE_CAMBIAN_LA_AGENDA) {
  test(`${ruta} no acepta la seccion de simulacion`, () => {
    assert.equal(readFileSync(ruta, 'utf8').includes("'/admin/pruebas'"), false)
  })
}

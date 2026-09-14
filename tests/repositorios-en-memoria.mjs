// Las pruebas trabajan SIEMPRE contra la implementacion en memoria.
//
// Desde que `lib/*/repositorio.ts` apunta a PostgreSQL, cualquier prueba que
// ejecute un route handler escribiria en la base de datos REAL del hospital:
// crearia consultorios y pacientes de mentira en produccion, y ademas dejaria
// las pruebas dependiendo de que haya red. Este modulo sustituye los dos
// selectores por la version en memoria, que cumple el mismo contrato.
//
// Hay que importarlo ANTES que cualquier route handler, que es lo que arrastra
// el selector.
import { mock } from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RAIZ = path.resolve(import.meta.dirname, '..')
const comoUrl = (relativa) => pathToFileURL(path.join(RAIZ, relativa)).href

const { turnoRepository } = await import('@/lib/turnos/in-memory-repository')
const { usuarioRepository } = await import('@/lib/usuarios/in-memory-repository')

mock.module(comoUrl('lib/turnos/repositorio.ts'), { namedExports: { turnoRepository } })
mock.module(comoUrl('lib/usuarios/repositorio.ts'), { namedExports: { usuarioRepository } })

export { turnoRepository, usuarioRepository }

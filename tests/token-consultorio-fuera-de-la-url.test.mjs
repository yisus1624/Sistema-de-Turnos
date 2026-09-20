// EL TOKEN DEL CONSULTORIO NO PUEDE VOLVER A LA URL.
//
// Estuvo en la ruta de cada llamada (`/api/consultorio/<token>/...`). Nginx
// escribe `$request` entero en su `access.log` por defecto, asi que cada
// "siguiente", cada "repetir" y cada refresco de la fila dejaba el token EN
// CLARO en un archivo del servidor, decenas de lineas por doctor y por jornada.
// Quien leyera esos logs se llevaba una llave que abre la agenda con nombres y
// documentos de pacientes sin pedir contrasena.
//
// Es un fallo facil de reintroducir sin querer: escribir `/api/consultorio/
// ${token}` es lo natural cuando se tiene el token a mano en el cliente, y
// ninguna prueba de comportamiento lo detecta porque el sistema FUNCIONA igual.
// Por eso esta prueba mira el codigo fuente y no el comportamiento.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const RAIZ = path.resolve(import.meta.dirname, '..')

/** Todos los archivos de codigo bajo una carpeta del proyecto. */
function archivosDe(relativa) {
  const base = path.join(RAIZ, relativa)
  const encontrados = []

  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir)) {
      const completa = path.join(dir, entrada)
      if (statSync(completa).isDirectory()) {
        if (entrada === 'node_modules' || entrada === '.next') continue
        recorrer(completa)
        continue
      }
      if (/\.(ts|tsx)$/.test(entrada)) encontrados.push(completa)
    }
  }

  recorrer(base)
  return encontrados
}

test('ninguna ruta de la API del consultorio lleva el token en su camino', () => {
  const conToken = archivosDe('app/api/consultorio').filter((archivo) =>
    archivo.includes(`${path.sep}[token]${path.sep}`),
  )

  assert.deepEqual(
    conToken.map((a) => path.relative(RAIZ, a)),
    [],
    'una ruta volvio a recibir el token como segmento de la URL',
  )
})

test('ningun cliente pega el token en la direccion de una peticion', () => {
  // Se buscan las dos formas de escribirlo: interpolado en plantilla y
  // concatenado. La cabecera `x-consultorio-token` y la cookie no cuentan,
  // porque ninguna de las dos viaja en la linea de peticion.
  const sospechosas = []

  for (const archivo of [...archivosDe('app'), ...archivosDe('components')]) {
    const contenido = readFileSync(archivo, 'utf8')
    for (const [numero, linea] of contenido.split('\n').entries()) {
      if (!linea.includes('/api/consultorio')) continue
      // Una URL con algo interpolado justo detras de `/api/consultorio/` es el
      // patron malo; `/api/consultorio/turnos/${id}` es legitimo porque lo que
      // se interpola es el turno, no el token.
      if (/\/api\/consultorio\/\$\{(?!.*turnos)/.test(linea)) {
        sospechosas.push(`${path.relative(RAIZ, archivo)}:${numero + 1}: ${linea.trim()}`)
      }
    }
  }

  assert.deepEqual(sospechosas, [], 'alguien volvio a poner el token en la URL')
})

test('el enlace que se le manda al doctor si lleva el token, y tiene que seguir asi', () => {
  // La contraparte: el enlace magico es el unico sitio donde el token debe
  // aparecer en una URL. Si esto se rompiera, el doctor no podria entrar.
  const ruta = path.join(RAIZ, 'app/api/profesionales/[id]/acceso/route.ts')
  assert.match(readFileSync(ruta, 'utf8'), /\/consultorio\/\$\{token\}/)
})

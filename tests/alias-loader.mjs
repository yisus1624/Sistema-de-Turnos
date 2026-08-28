// Loader SOLO para pruebas. Hace dos cosas que en la aplicacion resuelve el
// bundler de Next.js y aqui no existen:
//
//   1. Traduce el alias "@/*" del tsconfig.json a rutas del proyecto.
//   2. Le agrega la extension .ts/.tsx a los imports sin extension, tanto de
//      alias como relativos ("./privacidad"), que es como se escribe en
//      TypeScript pero que Node ESM no resuelve solo.
//
// Node 24 ejecuta TypeScript directamente (type stripping), asi que no hace
// falta compilar. No lo usa el codigo de la aplicacion.
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const extensiones = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function resolverConExtension(rutaBase) {
  if (existsSync(rutaBase) && path.extname(rutaBase)) return rutaBase
  return extensiones.map((ext) => `${rutaBase}${ext}`).find((ruta) => existsSync(ruta)) ?? null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const encontrado = resolverConExtension(path.join(root, specifier.slice(2)))
    return nextResolve(pathToFileURL(encontrado ?? path.join(root, specifier.slice(2))).href, context)
  }

  // Import relativo desde un archivo TypeScript, sin extension.
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const directorioPadre = path.dirname(fileURLToPath(context.parentURL))
    const encontrado = resolverConExtension(path.resolve(directorioPadre, specifier))
    if (encontrado) return nextResolve(pathToFileURL(encontrado).href, context)
  }

  return nextResolve(specifier, context)
}

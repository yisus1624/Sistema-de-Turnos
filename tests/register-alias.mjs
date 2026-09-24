// Registra el loader de alias para `node --test`. Ver alias-loader.mjs.
import { register } from 'node:module'

// Guarda global: sin una base de pruebas explicita, ninguna prueba puede
// alcanzar la base real aunque DATABASE_URL venga cargada del entorno.
if (!process.env.TEST_DATABASE_URL) {
  const SIN_BASE = 'postgresql://pruebas:pruebas@127.0.0.1:1/sin-base'
  process.env.DATABASE_URL = SIN_BASE
  process.env.DIRECT_URL = SIN_BASE
}

register('./alias-loader.mjs', import.meta.url)

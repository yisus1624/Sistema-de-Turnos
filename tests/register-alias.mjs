// Registra el loader de alias para `node --test`. Ver alias-loader.mjs.
import { register } from 'node:module'

register('./alias-loader.mjs', import.meta.url)

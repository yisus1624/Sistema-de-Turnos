/**
 * EL UNICO SITIO DONDE SE ELIGE DE DONDE SALEN LOS USUARIOS.
 *
 * Gemelo de `lib/turnos/repositorio.ts`, y por el mismo motivo: la
 * autenticacion, la pantalla de usuarios y los guardas importan
 * `usuarioRepository` DE AQUI, tipado con el contrato `UsuarioRepository` y no
 * con la clase concreta que hoy lo cumple.
 *
 * El hospital todavia no ha confirmado como se autentican sus funcionarios
 * —directorio activo, SSO, su propia API o cuentas locales— (ver
 * `lib/hospital/README.md`). Cuando lo confirme, se escribe la implementacion
 * nueva y se cambia la asignacion de abajo; nada mas del sistema se toca.
 *
 * Que este tipado con la interfaz importa especialmente aqui: si una pantalla
 * llegara a usar un metodo que solo existe en la version en memoria, el dia que
 * se conecte el directorio del hospital ese metodo no estaria, y el fallo
 * saldria en la cara del funcionario intentando entrar a trabajar.
 */
import { usuarioRepository as enPostgres } from './prisma-repository'
import type { UsuarioRepository } from './repository'

/**
 * FUENTE ACTUAL: PostgreSQL (Supabase), via `prisma-repository`. Las cuentas
 * semilla se crean una sola vez con `npm run db:seed`, en vez de recrearse en
 * cada arranque; asi los permisos que el administrador cambia se quedan
 * cambiados.
 */
export const usuarioRepository: UsuarioRepository = enPostgres

export type { UsuarioRepository }

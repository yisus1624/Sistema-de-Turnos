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
import { usuarioRepository as enMemoria } from './in-memory-repository'
import type { UsuarioRepository } from './repository'

export const usuarioRepository: UsuarioRepository = enMemoria

export type { UsuarioRepository }

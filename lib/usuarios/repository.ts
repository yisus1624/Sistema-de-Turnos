import type { DatosUsuario, Usuario } from './types'

/**
 * Contrato de acceso a los usuarios internos del sistema.
 *
 * Igual que `TurnoRepository`, la aplicacion habla SIEMPRE con este contrato y
 * nunca con una fuente concreta. Asi, cuando el hospital confirme como se
 * autentican sus funcionarios (directorio activo, SSO, su propia API o
 * cuentas locales), solo se escribe una implementacion nueva.
 *
 * Implementaciones previstas:
 *   - En memoria / variables de entorno (actual, para desarrollo y demo).
 *   - Directorio o API del hospital -> `lib/hospital`  [PENDIENTE DE CONFIRMACION]
 */
export interface UsuarioRepository {
  /** Valida usuario + contrasena. Devuelve null si no coincide o esta inactivo. */
  verificarCredenciales(usuario: string, password: string): Promise<Usuario | null>
  buscarPorId(id: string): Promise<Usuario | null>
  listar(): Promise<Usuario[]>
  crear(datos: DatosUsuario): Promise<Usuario>
  actualizar(id: string, datos: Partial<DatosUsuario>): Promise<Usuario>
  /** Desactivar en lugar de borrar: el historico de turnos referencia al funcionario. */
  desactivar(id: string): Promise<Usuario>
}

/**
 * Tipos de dominio de los usuarios internos del sistema.
 *
 * Fuente: "Documento de Requerimientos del Sistema - Sistema de Gestion y
 * Llamado de Turnos, ESE Hospital San Rafael de Chinu, v1.0", seccion 16
 * (Administracion de usuarios) y seccion 17 (Seguridad).
 *
 * El sistema NO almacena datos del paciente: solo funcionarios (seccion 17).
 */

/** Roles iniciales del sistema (requerimiento seccion 16). */
export type RolUsuario = 'ADMINISTRADOR' | 'OPERADOR'

/** Usuario interno tal como lo consume la aplicacion (sin credenciales). */
export interface Usuario {
  id: string
  /** Nombre completo del funcionario. */
  nombre: string
  /** Nombre de usuario para iniciar sesion (requerimiento seccion 17). */
  usuario: string
  rol: RolUsuario
  /** Area a la que pertenece el funcionario (ej: Facturacion, SIAU). */
  area: string | null
  activo: boolean
  fechaCreacion: string
  /**
   * Secciones del menu (hrefs) a las que puede entrar un OPERADOR. `null` o
   * `undefined` significa acceso a todas las secciones de su rol. Se ignora
   * para ADMINISTRADOR, que siempre ve todo.
   */
  secciones?: string[] | null
}

/** Datos para crear o editar un usuario desde la administracion. */
export interface DatosUsuario {
  nombre: string
  usuario: string
  rol: RolUsuario
  area?: string | null
  activo?: boolean
  /** Solo al crear o al cambiar la contrasena. */
  password?: string
  secciones?: string[] | null
}

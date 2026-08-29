import type { RolUsuario } from '@/lib/usuarios/types'

export type AuthSessionUser = {
  id: string
  usuario: string
  rol: RolUsuario
  area: string | null
  secciones: string[] | null
}

/**
 * Destino inicial de cada rol despues de iniciar sesion. Para OPERADOR es la
 * primera seccion de su menu a la que tiene acceso (ver `secciones` en
 * `Usuario`), no siempre la misma ruta.
 */
export type RutaInicialRol = string

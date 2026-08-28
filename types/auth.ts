import type { RolUsuario } from '@/lib/usuarios/types'

export type AuthSessionUser = {
  id: string
  usuario: string
  rol: RolUsuario
  area: string | null
}

/** Destino inicial de cada rol despues de iniciar sesion. */
export type RutaInicialRol = '/admin/turnos' | '/operador'

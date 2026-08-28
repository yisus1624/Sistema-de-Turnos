import type { RolUsuario } from '@/lib/usuarios/types'

export type PermissionContext = {
  usuarioId: string
  rol: RolUsuario
}

/** Permisos por modulo segun los roles del requerimiento (secciones 6, 15 y 16). */
export type ModulePermission =
  | 'usuarios:gestionar'
  | 'servicios:gestionar'
  | 'modulos:gestionar'
  | 'turnos:llamar'
  | 'historico:consultar'
  | 'estadisticas:consultar'
  | 'configuracion:gestionar'

export const permisosPorRol: Record<RolUsuario, ModulePermission[]> = {
  ADMINISTRADOR: [
    'usuarios:gestionar',
    'servicios:gestionar',
    'modulos:gestionar',
    'turnos:llamar',
    'historico:consultar',
    'estadisticas:consultar',
    'configuracion:gestionar',
  ],
  OPERADOR: ['turnos:llamar', 'historico:consultar'],
}

export function puede(rol: RolUsuario, permiso: ModulePermission) {
  return permisosPorRol[rol].includes(permiso)
}

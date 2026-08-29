/**
 * Catalogo de secciones del sistema y reglas de acceso.
 *
 * Vive aparte de `components/layout/navigation.ts` porque ese archivo importa
 * los iconos de `@phosphor-icons/react`, que no se pueden evaluar en el bundle
 * de servidor. Estas funciones son puras y las necesitan tanto el servidor
 * (proteger paginas y APIs, decidir a donde redirigir) como el cliente
 * (dibujar el menu y el selector de permisos).
 *
 * PERMISOS (confirmado con el hospital): el administrador ve todo. A un
 * OPERADOR se le puede recortar el menu, y tambien se le puede dar cualquier
 * seccion de administracion que necesite, sin volverlo administrador. Por eso
 * `Usuario.secciones` guarda hrefs sueltos y no un rol:
 *
 *   - `null`  -> las secciones propias de su rol (comportamiento por defecto).
 *   - `[...]` -> exactamente esas, vengan del menu de operador o del de admin.
 *
 * Esta lista es la fuente unica: el menu, el selector de permisos y los guardas
 * de las paginas y las APIs salen de aqui. Al agregar una seccion, agregale
 * tambien su icono en `navigation.ts` (si se olvida, el menu la muestra con un
 * icono generico en lugar de romperse).
 *
 * Las reglas de acceso estan cubiertas en `tests/permisos-secciones.test.mjs`.
 */
import type { RolUsuario } from '@/lib/usuarios/types'

export type SeccionSistema = {
  href: string
  label: string
  /** Grupo con el que se muestra en el menu y en el selector de permisos. */
  grupo: string
  /** Rol al que pertenece la seccion por defecto. */
  rol: RolUsuario
}

export const secciones: SeccionSistema[] = [
  // --- Administrador ---
  { href: '/admin/turnos', label: 'Turnos en curso', grupo: 'Operacion', rol: 'ADMINISTRADOR' },
  { href: '/admin/historico', label: 'Historico', grupo: 'Operacion', rol: 'ADMINISTRADOR' },
  { href: '/admin/estadisticas', label: 'Estadisticas', grupo: 'Operacion', rol: 'ADMINISTRADOR' },
  { href: '/admin/reportes', label: 'Reportes', grupo: 'Operacion', rol: 'ADMINISTRADOR' },
  { href: '/admin/servicios', label: 'Servicios', grupo: 'Configuracion', rol: 'ADMINISTRADOR' },
  { href: '/admin/modulos', label: 'Modulos y ventanillas', grupo: 'Configuracion', rol: 'ADMINISTRADOR' },
  { href: '/admin/profesionales', label: 'Profesionales', grupo: 'Configuracion', rol: 'ADMINISTRADOR' },
  { href: '/admin/usuarios', label: 'Usuarios', grupo: 'Configuracion', rol: 'ADMINISTRADOR' },
  { href: '/admin/pantalla', label: 'Pantalla y audio', grupo: 'Configuracion', rol: 'ADMINISTRADOR' },
  { href: '/admin/pruebas', label: 'Simulacion de carga', grupo: 'Pruebas', rol: 'ADMINISTRADOR' },

  // --- Operador ---
  { href: '/operador/agenda', label: 'Agenda de citas', grupo: 'Atencion', rol: 'OPERADOR' },
  { href: '/operador/admisiones', label: 'Registro de llegada', grupo: 'Atencion', rol: 'OPERADOR' },
  { href: '/operador', label: 'Llamado de turnos', grupo: 'Atencion', rol: 'OPERADOR' },
  { href: '/operador/historico', label: 'Historico', grupo: 'Atencion', rol: 'OPERADOR' },
]

/** Secciones que le corresponden a un rol cuando no se le recorta el acceso. */
export function seccionesDelRol(rol: RolUsuario): SeccionSistema[] {
  return secciones.filter((seccion) => seccion.rol === rol)
}

/**
 * Si un usuario puede entrar a una seccion.
 *
 * `secciones` en `null`/`undefined` significa "las de su rol"; una lista
 * explicita manda sobre el rol y puede incluir secciones de administracion.
 */
export function puedeVerSeccion(
  rol: RolUsuario,
  seccionesDelUsuario: string[] | null | undefined,
  href: string,
) {
  if (seccionesDelUsuario) return seccionesDelUsuario.includes(href)
  return secciones.some((seccion) => seccion.rol === rol && seccion.href === href)
}

/** Primera seccion a la que el usuario si tiene acceso; su pantalla de entrada. */
export function primeraRutaPermitida(rol: RolUsuario, seccionesDelUsuario?: string[] | null) {
  // Se recorre el catalogo (no la lista del usuario) para respetar el orden del
  // menu: la entrada deberia ser la primera seccion que ve, no la primera que
  // marcaron al crearlo.
  const permitida = secciones.find((seccion) => puedeVerSeccion(rol, seccionesDelUsuario, seccion.href))
  return permitida?.href ?? '/auth/login'
}

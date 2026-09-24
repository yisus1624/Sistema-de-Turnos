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
  { href: '/admin/citas', label: 'Citas', grupo: 'Operacion', rol: 'ADMINISTRADOR' },
  { href: '/admin/enlaces', label: 'Enlaces de consultorio', grupo: 'Operacion', rol: 'ADMINISTRADOR' },
  // Reportes vuelve al menu (pedido del hospital, sep. 2026): el PDF de turnos
  // por periodo, con su resumen. Historico y estadisticas siguen retirados.
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
  // Solo poner en marcha el televisor: quien abre la sala en la mañana lo
  // enciende. La configuracion de la pantalla y de la agenda vive aparte, en
  // '/admin/pantalla', que es de administracion porque ahi se cambian
  // parametros que le mueven la agenda a todo el hospital.
  { href: '/operador/pantalla', label: 'Abrir pantalla', grupo: 'Atencion', rol: 'OPERADOR' },

  // RETIRADAS del menu por decision del hospital (no borradas). Al no estar en
  // este catalogo, `puedeVerSeccion` se las niega a todo el mundo: la pantalla
  // redirige y las APIs que las exigen responden 403. Para devolver cualquiera,
  // basta con volver a listarla aqui.
  //
  // Historico y estadisticas: fuera mientras se define de donde van a venir
  // esos datos. Su codigo sigue en `app/admin/historico`,
  // `app/admin/estadisticas` y `app/operador/historico`.
  //   { href: '/admin/historico', label: 'Historico', grupo: 'Operacion', rol: 'ADMINISTRADOR' },
  //   { href: '/admin/estadisticas', label: 'Estadisticas', grupo: 'Operacion', rol: 'ADMINISTRADOR' },
  //   { href: '/operador/historico', label: 'Historico', grupo: 'Atencion', rol: 'OPERADOR' },
  //
  // Llamado de turnos: EL OPERADOR NO PASA TURNOS. Cada medico llama a sus
  // propios pacientes desde el enlace de su consultorio, y el operador solo
  // agenda citas y registra llegadas. Esta pantalla servia para las filas por
  // orden de llegada (ventanilla), que el hospital no usa. Su codigo sigue en
  // `app/operador/page.tsx`, y las APIs de pasar turno exigen esta seccion
  // (ver los `requireSeccion('/operador')`), asi que hoy no las puede usar
  // nadie. Si algun dia se abre una ventanilla, se descomenta y todo vuelve.
  //   { href: '/operador', label: 'Llamado de turnos', grupo: 'Atencion', rol: 'OPERADOR' },
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

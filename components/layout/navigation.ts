import type { Icon } from '@phosphor-icons/react'
import {
  CalendarPlus,
  ChartBar,
  ClockCounterClockwise,
  FileText,
  Flask,
  Gear,
  Megaphone,
  MonitorPlay,
  Stack,
  Stethoscope,
  Ticket,
  UserFocus,
  UsersThree,
} from '@phosphor-icons/react'
import { puedeVerSeccion, secciones, type SeccionSistema } from '@/lib/permissions/rutas'
import type { RolUsuario } from '@/lib/usuarios/types'

export type NavItem = SeccionSistema & { icon: Icon }

export type NavSection = {
  label: string
  items: NavItem[]
}

export const rolLabels: Record<RolUsuario, string> = {
  ADMINISTRADOR: 'Administrador',
  OPERADOR: 'Operador',
}

/**
 * Icono de cada seccion. El catalogo (href, etiqueta, grupo, rol) vive en
 * `lib/permissions/rutas.ts`; aqui solo se le pone la cara, porque los iconos
 * no se pueden importar desde el servidor.
 */
const iconos: Record<string, Icon> = {
  '/admin/turnos': Ticket,
  '/admin/historico': ClockCounterClockwise,
  '/admin/estadisticas': ChartBar,
  '/admin/reportes': FileText,
  '/admin/servicios': Stack,
  '/admin/modulos': Gear,
  '/admin/profesionales': Stethoscope,
  '/admin/usuarios': UsersThree,
  '/admin/pantalla': MonitorPlay,
  '/admin/pruebas': Flask,
  '/operador/agenda': CalendarPlus,
  '/operador/admisiones': UserFocus,
  '/operador': Megaphone,
  '/operador/historico': ClockCounterClockwise,
}

/** Icono de respaldo: una seccion sin icono no debe romper el menu. */
const ICONO_POR_DEFECTO: Icon = Ticket

/**
 * Menu que le corresponde a un usuario, agrupado como en el catalogo.
 *
 * Se recorren TODAS las secciones (no solo las del rol) porque a un operador se
 * le puede haber dado una seccion de administracion; `puedeVerSeccion` decide
 * cual entra. Los grupos que quedan vacios no se devuelven.
 */
export function navDelUsuario(rol: RolUsuario, seccionesDelUsuario?: string[] | null): NavSection[] {
  const grupos: NavSection[] = []

  for (const seccion of secciones) {
    if (!puedeVerSeccion(rol, seccionesDelUsuario, seccion.href)) continue

    const item: NavItem = { ...seccion, icon: iconos[seccion.href] ?? ICONO_POR_DEFECTO }
    const grupo = grupos.find((g) => g.label === seccion.grupo)
    if (grupo) grupo.items.push(item)
    else grupos.push({ label: seccion.grupo, items: [item] })
  }

  return grupos
}

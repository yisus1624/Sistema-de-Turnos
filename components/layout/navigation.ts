import type { Icon } from '@phosphor-icons/react'
import {
  CalendarPlus,
  ChartBar,
  ClockCounterClockwise,
  Gear,
  Megaphone,
  MonitorPlay,
  Stack,
  Stethoscope,
  Ticket,
  UserFocus,
  UsersThree,
} from '@phosphor-icons/react'
import type { RolUsuario } from '@/lib/usuarios/types'

export type NavItem = {
  label: string
  href: string
  icon: Icon
  badge?: string
}

export type NavSection = {
  label: string
  items: NavItem[]
}

export const rolLabels: Record<RolUsuario, string> = {
  ADMINISTRADOR: 'Administrador',
  OPERADOR: 'Operador',
}

/**
 * Menu por rol segun el requerimiento:
 *   - Administrador (seccion 6.1): usuarios, servicios, modulos, prefijos,
 *     historico, estadisticas y parametros generales.
 *   - Operador (seccion 6.2): llamar turnos y consultar los ya llamados.
 */
export const rolNav: Record<RolUsuario, NavSection[]> = {
  ADMINISTRADOR: [
    {
      label: 'Operacion',
      items: [
        { label: 'Turnos en curso', href: '/admin/turnos', icon: Ticket },
        { label: 'Historico', href: '/admin/historico', icon: ClockCounterClockwise },
        { label: 'Estadisticas', href: '/admin/estadisticas', icon: ChartBar },
      ],
    },
    {
      label: 'Configuracion',
      items: [
        { label: 'Servicios', href: '/admin/servicios', icon: Stack },
        { label: 'Modulos y ventanillas', href: '/admin/modulos', icon: Gear },
        { label: 'Profesionales', href: '/admin/profesionales', icon: Stethoscope },
        { label: 'Usuarios', href: '/admin/usuarios', icon: UsersThree },
        { label: 'Pantalla y audio', href: '/admin/pantalla', icon: MonitorPlay },
      ],
    },
  ],
  OPERADOR: [
    {
      label: 'Atencion',
      items: [
        { label: 'Agenda de citas', href: '/operador/agenda', icon: CalendarPlus },
        { label: 'Registro de llegada', href: '/operador/admisiones', icon: UserFocus },
        { label: 'Llamado de turnos', href: '/operador', icon: Megaphone },
        { label: 'Historico', href: '/operador/historico', icon: ClockCounterClockwise },
      ],
    },
  ],
}

export function rutasDelRol(rol: RolUsuario) {
  return rolNav[rol].flatMap((section) => section.items)
}

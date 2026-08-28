import type { RolUsuario } from '@/lib/usuarios/types'
import AppShell from './AppShell'

type RoleLoadingShellProps = {
  rol: RolUsuario
  title: string
  children: React.ReactNode
}

export default function RoleLoadingShell({ rol, title, children }: RoleLoadingShellProps) {
  return (
    <AppShell rol={rol} title={title} description="Cargando la informacion de esta seccion.">
      {children}
    </AppShell>
  )
}

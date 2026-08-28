import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import type { RolUsuario } from '@/lib/usuarios/types'
import AppShell from './AppShell'

type RoleShellProps = {
  rol: RolUsuario
  title: string
  description: string
  children: React.ReactNode
}

/** Envoltura de las pantallas internas: verifica sesion y rol (seccion 17). */
export default async function RoleShell({ rol, title, description, children }: RoleShellProps) {
  const session = await auth()

  if (!session?.user) redirect('/auth/login')
  if (session.user.rol !== rol) redirect('/auth/redirect')

  return (
    <AppShell
      rol={rol}
      title={title}
      description={description}
      nombreUsuario={session.user.name}
      area={session.user.area}
    >
      {children}
    </AppShell>
  )
}

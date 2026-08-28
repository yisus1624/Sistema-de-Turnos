import { redirect } from 'next/navigation'
import RoleShell from '@/components/layout/RoleShell'
import { auth } from '@/lib/auth'
import UsuariosClient from './UsuariosClient'

export const metadata = { title: 'Usuarios' }

export default async function UsuariosPage() {
  const session = await auth()
  if (!session?.user) redirect('/auth/login')

  return (
    <RoleShell
      rol="ADMINISTRADOR"
      title="Usuarios"
      description="Funcionarios que usan el sistema. Las cuentas no se borran: se desactivan, para no perder el rastro de quien llamo cada turno."
    >
      <UsuariosClient usuarioActualId={session.user.id} />
    </RoleShell>
  )
}

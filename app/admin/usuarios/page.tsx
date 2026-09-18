import { redirect } from 'next/navigation'
import RoleShell from '@/components/layout/RoleShell'
import { auth } from '@/lib/auth'
import { alcanceDe } from '@/lib/usuarios/politica-permisos'
import UsuariosClient from './UsuariosClient'

export const metadata = { title: 'Usuarios' }

export default async function UsuariosPage() {
  const session = await auth()
  if (!session?.user) redirect('/auth/login')

  return (
    <RoleShell
      rol="ADMINISTRADOR" seccion="/admin/usuarios"
      title="Usuarios"
      description="Funcionarios que usan el sistema. Las cuentas no se borran: se desactivan, para no perder el rastro de quien llamo cada turno."
    >
      {/*
        El ALCANCE de quien esta mirando, no solo su id. La pantalla no puede
        ofrecerle repartir secciones que el servidor le va a rechazar: antes el
        selector mostraba las trece a cualquiera con esta seccion, y un operador
        rellenaba la ficha entera para recibir un 403 al guardar.
      */}
      <UsuariosClient
        usuarioActualId={session.user.id}
        esAdministrador={session.user.rol === 'ADMINISTRADOR'}
        seccionesPropias={[...alcanceDe(session.user.rol, session.user.secciones)]}
      />
    </RoleShell>
  )
}

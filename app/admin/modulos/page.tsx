import RoleShell from '@/components/layout/RoleShell'
import ModulosClient from './ModulosClient'

export const metadata = { title: 'Modulos y ventanillas' }

export default function Pagina() {
  return (
    <RoleShell rol="ADMINISTRADOR" seccion="/admin/modulos" title="Modulos y ventanillas" description="Consultorios y ventanillas donde se atiende, y a que servicio pertenece cada uno.">
      <ModulosClient />
    </RoleShell>
  )
}

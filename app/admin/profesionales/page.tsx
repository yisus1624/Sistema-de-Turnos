import RoleShell from '@/components/layout/RoleShell'
import ProfesionalesClient from './ProfesionalesClient'

export const metadata = { title: 'Profesionales' }

export default function Pagina() {
  return (
    <RoleShell
      rol="ADMINISTRADOR" seccion="/admin/profesionales"
      title="Profesionales"
      description="Genera el enlace temporal con el que cada doctor entra a su consultorio, sin usuario ni contrasena."
    >
      <ProfesionalesClient />
    </RoleShell>
  )
}

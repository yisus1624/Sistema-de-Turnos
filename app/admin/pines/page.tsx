import RoleShell from '@/components/layout/RoleShell'
import PinesClient from './PinesClient'

export const metadata = { title: 'PIN de medicos' }

export default function PinesPage() {
  return (
    <RoleShell
      rol="ADMINISTRADOR"
      seccion="/admin/pines"
      title="PIN de medicos"
      description="El PIN de 6 digitos con que cada medico entra a su consultorio, sin enlaces. Lo sortea el sistema, lo entregas tu, y lo puedes cambiar o desactivar cuando quieras."
    >
      <PinesClient />
    </RoleShell>
  )
}

import RoleShell from '@/components/layout/RoleShell'
import AdmisionesClient from './AdmisionesClient'

export const metadata = { title: 'Registro de llegada' }

export default function AdmisionesPage() {
  return (
    <RoleShell
      rol="OPERADOR"
      title="Registro de llegada"
      description="Busca al paciente por su documento y confirma que llego. Desde ese momento aparece en la fila de su profesional."
    >
      <AdmisionesClient />
    </RoleShell>
  )
}

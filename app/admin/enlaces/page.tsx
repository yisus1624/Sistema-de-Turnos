import RoleShell from '@/components/layout/RoleShell'
import EnlacesClient from '@/components/profesionales/EnlacesClient'

export const metadata = { title: 'Enlaces de consultorio' }

export default function EnlacesPage() {
  return (
    <RoleShell
      rol="ADMINISTRADOR"
      seccion="/admin/enlaces"
      title="Enlaces de consultorio"
      description="Genera y reparte el enlace con el que cada doctor entra a llamar a sus pacientes. Dura lo que dure su turno y se puede revocar en cualquier momento."
    >
      <EnlacesClient />
    </RoleShell>
  )
}

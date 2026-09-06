import RoleShell from '@/components/layout/RoleShell'
import AgendaCitasClient from '@/components/citas/AgendaCitasClient'

export const metadata = { title: 'Citas' }

export default function CitasPage() {
  return (
    <RoleShell
      rol="ADMINISTRADOR"
      seccion="/admin/citas"
      title="Citas"
      description="Quien tiene cita, con que doctor y a que hora. Aqui se crean las citas y se les asigna profesional; el turno se genera cuando el paciente llega."
    >
      <AgendaCitasClient />
    </RoleShell>
  )
}

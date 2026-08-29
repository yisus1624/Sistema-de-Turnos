import RoleShell from '@/components/layout/RoleShell'
import AgendaClient from './AgendaClient'

export const metadata = { title: 'Agenda de citas' }

export default function AgendaPage() {
  return (
    <RoleShell
      rol="OPERADOR"
      seccion="/operador/agenda"
      title="Agenda de citas"
      description="Registra al paciente y asignale un profesional. La cita se convierte en turno cuando el paciente llega."
    >
      <AgendaClient />
    </RoleShell>
  )
}

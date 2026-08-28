import RoleShell from '@/components/layout/RoleShell'
import OperadorClient from './OperadorClient'

export const metadata = { title: 'Llamado de turnos' }

export default function OperadorPage() {
  return (
    <RoleShell
      rol="OPERADOR"
      title="Llamado de turnos"
      description="Selecciona el servicio y el modulo desde el que atiendes, llama el siguiente turno y registra el resultado de la atencion."
    >
      <OperadorClient />
    </RoleShell>
  )
}

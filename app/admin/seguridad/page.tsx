import RoleShell from '@/components/layout/RoleShell'
import RegistroActividadClient from './RegistroActividadClient'

export const metadata = { title: 'Registro de actividad' }

export default function SeguridadPage() {
  return (
    <RoleShell
      rol="ADMINISTRADOR"
      seccion="/admin/seguridad"
      title="Registro de actividad"
      description="Quien hizo que y cuando: inicios de sesion, cambios de cuentas, enlaces de consultorio y el recorrido de las citas y los turnos."
    >
      <RegistroActividadClient />
    </RoleShell>
  )
}

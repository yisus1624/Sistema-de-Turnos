import RoleShell from '@/components/layout/RoleShell'
import ServiciosClient from './ServiciosClient'

export const metadata = { title: 'Servicios' }

export default function Pagina() {
  return (
    <RoleShell rol="ADMINISTRADOR" seccion="/admin/servicios" title="Servicios" description="Crea y edita los servicios de atencion, su prefijo de turno y si atienden por ventanilla o por cita.">
      <ServiciosClient />
    </RoleShell>
  )
}

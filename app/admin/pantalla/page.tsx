import RoleShell from '@/components/layout/RoleShell'
import PantallaConfigClient from './PantallaConfigClient'

export const metadata = { title: 'Pantalla' }

export default function Pagina() {
  return (
    <RoleShell
      rol="ADMINISTRADOR"
      seccion="/admin/pantalla"
      title="Pantalla"
      description="Abre la pantalla de la sala de espera y ajusta el volumen del llamado. Lo demas esta en Ajustes."
    >
      <PantallaConfigClient parte="pantalla" />
    </RoleShell>
  )
}

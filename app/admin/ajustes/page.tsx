import RoleShell from '@/components/layout/RoleShell'
import PantallaConfigClient from '../pantalla/PantallaConfigClient'

export const metadata = { title: 'Ajustes' }

export default function Pagina() {
  return (
    <RoleShell
      rol="ADMINISTRADOR"
      seccion="/admin/ajustes"
      title="Ajustes"
      description="Sonido del llamado, diseño del televisor, entrada de los medicos y horarios de atencion."
    >
      <PantallaConfigClient parte="ajustes" />
    </RoleShell>
  )
}

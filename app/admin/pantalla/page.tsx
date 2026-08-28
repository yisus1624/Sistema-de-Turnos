import RoleShell from '@/components/layout/RoleShell'
import PantallaConfigClient from './PantallaConfigClient'

export const metadata = { title: 'Pantalla y audio' }

export default function Pagina() {
  return (
    <RoleShell rol="ADMINISTRADOR" title="Pantalla y audio" description="Parametros de la pantalla de la sala de espera y del llamado por voz.">
      <PantallaConfigClient />
    </RoleShell>
  )
}

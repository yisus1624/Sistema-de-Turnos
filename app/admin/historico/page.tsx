import RoleShell from '@/components/layout/RoleShell'
import HistoricoTurnos from '@/components/admin/HistoricoTurnos'

export const metadata = { title: 'Historico de turnos' }

export default function Pagina() {
  return (
    <RoleShell rol="ADMINISTRADOR" title="Historico de turnos" description="Consulta de turnos generados y atendidos, con filtros por fecha, servicio, modulo, estado y codigo.">
      <HistoricoTurnos completo />
    </RoleShell>
  )
}

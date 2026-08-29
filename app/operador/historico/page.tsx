import RoleShell from '@/components/layout/RoleShell'
import HistoricoTurnos from '@/components/admin/HistoricoTurnos'

export const metadata = { title: 'Turnos que llamaste' }

export default function Pagina() {
  return (
    <RoleShell rol="OPERADOR" seccion="/operador/historico" title="Turnos que llamaste" description="Consulta los turnos que tu llamaste y como termino cada atencion.">
      <HistoricoTurnos completo={false} />
    </RoleShell>
  )
}

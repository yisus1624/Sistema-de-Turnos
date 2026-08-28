import RoleShell from '@/components/layout/RoleShell'
import EstadisticasClient from './EstadisticasClient'

export const metadata = { title: 'Estadisticas' }

export default function Pagina() {
  return (
    <RoleShell rol="ADMINISTRADOR" title="Estadisticas" description="Turnos generados, atendidos y ausentes, con tiempos promedio de espera y de atencion.">
      <EstadisticasClient />
    </RoleShell>
  )
}

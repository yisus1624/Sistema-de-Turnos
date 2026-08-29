import RoleShell from '@/components/layout/RoleShell'
import ReportesClient from './ReportesClient'

export const metadata = { title: 'Reportes' }

export default function Pagina() {
  return (
    <RoleShell
      rol="ADMINISTRADOR" seccion="/admin/reportes"
      title="Reportes"
      description="Filtra los turnos por rango de fechas y descarga el reporte en PDF."
    >
      <ReportesClient />
    </RoleShell>
  )
}

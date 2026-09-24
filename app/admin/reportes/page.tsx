import RoleShell from '@/components/layout/RoleShell'
import ReportesClient from './ReportesClient'

export const metadata = { title: 'Reportes' }

export default function Pagina() {
  return (
    <RoleShell
      rol="ADMINISTRADOR" seccion="/admin/reportes"
      title="Reportes"
      description="Elige un periodo, revisa el resumen y descarga el reporte en PDF para el hospital."
    >
      <ReportesClient />
    </RoleShell>
  )
}

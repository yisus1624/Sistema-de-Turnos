import RoleShell from '@/components/layout/RoleShell'
import TurnosEnCursoClient from './TurnosEnCursoClient'

export const metadata = { title: 'Turnos en curso' }

export default function Pagina() {
  return (
    <RoleShell rol="ADMINISTRADOR" seccion="/admin/turnos" title="Turnos en curso" description="Estado de la operacion en vivo: quien esta siendo atendido en cada punto y cuantos esperan por servicio.">
      <TurnosEnCursoClient />
    </RoleShell>
  )
}

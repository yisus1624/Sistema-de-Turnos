import RoleShell from '@/components/layout/RoleShell'
import ProfesionalesClient from './ProfesionalesClient'

export const metadata = { title: 'Profesionales' }

export default function Pagina() {
  return (
    <RoleShell
      rol="ADMINISTRADOR" seccion="/admin/profesionales"
      title="Profesionales"
      // La de antes describia "Enlaces de consultorio", que es otra pantalla:
      // esta no genera ningun enlace, muestra quien atiende cada dia.
      description="Quien atiende el dia que elijas, con su jornada, su horario y su consultorio. Los doctores entran solos con la carga del reporte; aqui se corrige su ficha."
    >
      <ProfesionalesClient />
    </RoleShell>
  )
}

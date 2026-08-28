import RoleShell from '@/components/layout/RoleShell'
import PruebasClient from './PruebasClient'

export const metadata = { title: 'Simulacion de carga' }

export default function Pagina() {
  return (
    <RoleShell
      rol="ADMINISTRADOR"
      title="Simulacion de carga"
      description="Pon a 10 consultorios a llamar pacientes al tiempo y mira como reacciona la pantalla de sala de espera, en vivo."
    >
      <PruebasClient />
    </RoleShell>
  )
}

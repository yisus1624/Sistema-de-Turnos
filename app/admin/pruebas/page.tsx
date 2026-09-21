import RoleShell from '@/components/layout/RoleShell'
import { simulacionHabilitada } from '@/lib/turnos/simulacion'
import PruebasClient from './PruebasClient'

export const metadata = { title: 'Simulacion de carga' }

export default function Pagina() {
  // Se resuelve en el servidor y baja como dato: el panel no puede preguntar
  // por una variable de entorno, y sin esto ofrecia botones que terminaban en
  // un 403 despues de que el administrador confirmara el reinicio del dia.
  const habilitada = simulacionHabilitada()

  return (
    <RoleShell
      rol="ADMINISTRADOR" seccion="/admin/pruebas"
      title="Simulacion de carga"
      description="Pon a 10 consultorios a llamar pacientes al tiempo y mira como reacciona la pantalla de sala de espera, en vivo."
    >
      <PruebasClient habilitada={habilitada} />
    </RoleShell>
  )
}

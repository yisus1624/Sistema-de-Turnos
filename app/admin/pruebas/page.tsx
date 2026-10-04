import RoleShell from '@/components/layout/RoleShell'
import { auth } from '@/lib/auth'
import { simulacionHabilitada } from '@/lib/turnos/simulacion'
import PruebasClient from './PruebasClient'

export const metadata = { title: 'Simulacion de carga' }

export default async function Pagina() {
  // Se resuelve en el servidor y baja como dato: solo la cuenta de
  // demostracion la tiene (ver `simulacionHabilitada`), y sin esto el panel
  // ofrecia botones que terminaban en un 403.
  const habilitada = simulacionHabilitada(await auth())

  return (
    <RoleShell
      rol="ADMINISTRADOR" seccion="/admin/pruebas"
      title="Simulacion de carga"
      description="Pon a 11 consultorios a llamar pacientes al tiempo y mira como reacciona la pantalla de sala de espera, en vivo."
    >
      <PruebasClient habilitada={habilitada} />
    </RoleShell>
  )
}

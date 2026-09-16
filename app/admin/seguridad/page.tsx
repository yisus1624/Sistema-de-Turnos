import RoleShell from '@/components/layout/RoleShell'
import { auth } from '@/lib/auth'
import RegistroActividadClient from './RegistroActividadClient'

export const metadata = { title: 'Registro de actividad' }

export default async function SeguridadPage() {
  // La purga de datos de pacientes la exige la API SOLO al administrador, y no
  // por seccion: un operador al que se le da "Registro de actividad" para que
  // pueda revisar la actividad no esta recibiendo con ello permiso para
  // anonimizar la agenda de medio año. Aqui se le esconde el boton para que no
  // vea una accion que le va a responder 403.
  const session = await auth()

  return (
    <RoleShell
      rol="ADMINISTRADOR"
      seccion="/admin/seguridad"
      title="Registro de actividad"
      description="Quien hizo que y cuando: inicios de sesion, cambios de cuentas, enlaces de consultorio y el recorrido de las citas y los turnos."
    >
      <RegistroActividadClient esAdministrador={session?.user?.rol === 'ADMINISTRADOR'} />
    </RoleShell>
  )
}

import RoleShell from '@/components/layout/RoleShell'
import AbrirPantallaClient from './AbrirPantallaClient'

export const metadata = { title: 'Abrir pantalla' }

/**
 * Puesta en marcha del televisor de la sala de espera.
 *
 * Es una tarea del mostrador —quien abre la sala en la mañana enciende la
 * pantalla—, por eso vive en el menu del operador y no en el de
 * administracion. La configuracion de la pantalla (audio, volumen, horarios)
 * es otra cosa y sigue en "Pantalla y audio", donde el operador no entra: ahi
 * se cambian parametros que le mueven la agenda a todo el hospital.
 */
export default function AbrirPantallaPage() {
  return (
    <RoleShell
      rol="OPERADOR"
      seccion="/operador/pantalla"
      title="Abrir pantalla"
      description="Pon en marcha el televisor de la sala de espera."
    >
      <AbrirPantallaClient />
    </RoleShell>
  )
}

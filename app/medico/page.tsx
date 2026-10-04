import { enMundo, MUNDO_REAL, mundoDeDemostracion } from '@/lib/demostracion/mundo'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { permitePin } from '@/lib/turnos/types'
import MedicoClient from './MedicoClient'

export const metadata = { title: 'Entrada de medicos' }
export const dynamic = 'force-dynamic'

/**
 * La entrada de los medicos con su PIN (ver `app/api/medico/pin`).
 *
 * Publica, como la del consultorio: el medico no tiene usuario del sistema.
 * Se abre desde el boton "¿Eres medico?" del inicio de sesion. Si ningun
 * hospital (ni el real ni el de prueba) usa la entrada con PIN, lo dice.
 */
export default async function PaginaMedico() {
  const conPin = await Promise.all(
    [MUNDO_REAL, mundoDeDemostracion()].map((mundo) =>
      enMundo(mundo, async () => permitePin((await turnoRepository.configuracion()).accesoProfesionales)),
    ),
  )
  return <MedicoClient conPin={conPin.some(Boolean)} />
}

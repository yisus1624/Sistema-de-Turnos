import { enMundo, MUNDO_REAL } from '@/lib/demostracion/mundo'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { permitePin } from '@/lib/turnos/types'
import LoginClient from './LoginClient'

export const dynamic = 'force-dynamic'

/**
 * El inicio de sesion. Con la entrada de medicos por PIN encendida EN EL
 * HOSPITAL REAL, arriba sale "¿Eres medico?": un toque y el medico escribe su
 * PIN, sin usuario ni contrasena.
 *
 * Solo el real, no la demostracion: este login lo ve el personal del
 * hospital, y no puede aparecerle un boton que el hospital no encendio solo
 * porque alguien puso la demostracion en PIN. Para mostrar la demo, se entra
 * directo a /medico, que si acepta los PIN de prueba.
 *
 * Si la configuracion no se pudiera leer, el boton no sale: el login de los
 * funcionarios no puede caerse por eso.
 */
export default async function LoginPage() {
  const conPin = await enMundo(MUNDO_REAL, async () =>
    permitePin((await turnoRepository.configuracion()).accesoProfesionales),
  ).catch(() => false)
  return <LoginClient conPin={conPin} />
}

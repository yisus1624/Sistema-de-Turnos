/**
 * Cuanto queda dentro un medico que entro con su PIN.
 *
 * HASTA QUE TERMINA SU JORNADA, MAS UNA HORA DE GRACIA. No treinta dias: el
 * computador del consultorio lo comparten el medico de la mañana y el de la
 * tarde, y una sesion larga dejaria al de la tarde viendo los pacientes del de
 * la mañana si este no cierra. El medico escribe su PIN una vez por jornada
 * (y "Cambiar de medico" deja entrar al siguiente).
 *
 * Fuera de su jornada (llego tarde, o atiende un sabado) se le dan dos horas.
 */
import { MINUTOS_ACCESO_MAXIMO, MINUTOS_ACCESO_MINIMO } from '@/lib/turnos/repository'
import { aMinutos, horaColombia } from '@/lib/turnos/tiempo'
import type { ConfiguracionSistema, Profesional } from '@/lib/turnos/types'

const MINUTOS_DE_GRACIA = 60
const MINUTOS_FUERA_DE_JORNADA = 120

export function minutosDeSesion(
  profesional: Pick<Profesional, 'jornada'>,
  horario: Pick<ConfiguracionSistema, 'jornadaMananaFin' | 'jornadaTardeFin'>,
  ahora: Date = new Date(),
): number {
  const fin = aMinutos(profesional.jornada === 'MANANA' ? horario.jornadaMananaFin : horario.jornadaTardeFin)
  const minutoActual = aMinutos(horaColombia(ahora))
  const hastaElFin = fin + MINUTOS_DE_GRACIA - minutoActual
  const minutos = Number.isFinite(hastaElFin) && hastaElFin > MINUTOS_DE_GRACIA / 2 ? hastaElFin : MINUTOS_FUERA_DE_JORNADA
  return Math.min(MINUTOS_ACCESO_MAXIMO, Math.max(MINUTOS_ACCESO_MINIMO, Math.round(minutos)))
}

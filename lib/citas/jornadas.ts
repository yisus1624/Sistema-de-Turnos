/**
 * La jornada de cada doctor, deducida de las horas a las que atiende.
 *
 * EL PROBLEMA QUE RESUELVE. El reporte del hospital no trae ninguna columna que
 * diga en que jornada trabaja cada quien, asi que todos los doctores entraban
 * como dia COMPLETO. En la parrilla eso significa que el medico que se va a las
 * once aparece tambien por la tarde, y que a alguien que a esa hora no esta en
 * el hospital se le puede citar un paciente a las tres. Sus horas si lo dicen, y
 * son el unico dato fiable que hay.
 *
 * Vive aparte de `importar-reporte` porque tiene DOS entradas: la carga diaria,
 * que la aplica sobre los dias que trae el archivo, y la pantalla de
 * Profesionales, desde donde el administrador la vuelve a pasar sobre lo que ya
 * esta cargado —que es lo que hace falta para los doctores que entraron antes
 * de que esto existiera—.
 */
import { prisma } from '@/lib/prisma'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { diaColombia, horaColombia, jornadaSegunHoras } from '@/lib/turnos/tiempo'
import type { Jornada } from '@/lib/turnos/types'

/** Un doctor al que se le corrigio la jornada. */
export interface AjusteDeJornada {
  nombre: string
  jornada: Jornada
}

/** Cuantos dias hacia atras se miran cuando no se dice otra cosa. */
const DIAS_POR_DEFECTO = 30

/**
 * Le pone a cada doctor la jornada que dicen sus citas.
 *
 * SE MIRAN LAS CITAS GUARDADAS, NO LAS FILAS DE UN ARCHIVO. El reporte puede
 * venir partido (primero la mañana, despues la tarde) o filtrado por un doctor.
 * Deduciendo desde el archivo, la segunda carga del dia le cambiaria la jornada
 * a TARDE a quien ya se habia visto por la mañana. Desde la base se ve el dia
 * entero, este donde este.
 *
 * Al doctor que no tiene ninguna cita en el periodo no se le toca: sin citas no
 * hay nada que deducir, y cambiarsela seria pisarle al administrador la que
 * puso a mano.
 */
export async function recalcularJornadas(opciones: {
  /** Dias AAAA-MM-DD a mirar. Por defecto, los ultimos `DIAS_POR_DEFECTO`. */
  fechas?: string[]
  /** Doctores a revisar. Por defecto, todos los activos. */
  profesionalIds?: string[]
} = {}): Promise<AjusteDeJornada[]> {
  const fechas = opciones.fechas ?? ultimosDias(DIAS_POR_DEFECTO)
  if (fechas.length === 0) return []

  const [configuracion, citas, doctores] = await Promise.all([
    turnoRepository.configuracion(),
    prisma.cita.findMany({
      where: {
        fecha: { in: fechas },
        estado: { not: 'CANCELADA' },
        ...(opciones.profesionalIds ? { profesionalId: { in: opciones.profesionalIds } } : {}),
      },
      select: { profesionalId: true, horaCita: true },
    }),
    prisma.profesional.findMany({
      where: opciones.profesionalIds ? { id: { in: opciones.profesionalIds } } : { activo: true },
      select: { id: true, nombre: true, jornada: true },
    }),
  ])

  const horasPorDoctor = new Map<string, string[]>()
  for (const cita of citas) {
    const hora = horaColombia(cita.horaCita)
    const horas = horasPorDoctor.get(cita.profesionalId)
    if (horas) horas.push(hora)
    else horasPorDoctor.set(cita.profesionalId, [hora])
  }

  const ajustes: AjusteDeJornada[] = []
  const porJornada = new Map<Jornada, string[]>()

  for (const doctor of doctores) {
    const jornada = jornadaSegunHoras(horasPorDoctor.get(doctor.id) ?? [], configuracion)
    if (!jornada || jornada === doctor.jornada) continue

    const lista = porJornada.get(jornada)
    if (lista) lista.push(doctor.id)
    else porJornada.set(jornada, [doctor.id])

    ajustes.push({ nombre: doctor.nombre, jornada })
  }

  if (porJornada.size > 0) {
    // Agrupado por jornada: son tres updates como mucho, y no uno por doctor
    // contra una base que esta al otro lado de internet.
    await prisma.$transaction(
      [...porJornada].map(([jornada, ids]) =>
        prisma.profesional.updateMany({ where: { id: { in: ids } }, data: { jornada } }),
      ),
    )
  }

  return ajustes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** Los ultimos `cuantos` dias en hora de Colombia, de hoy hacia atras. */
function ultimosDias(cuantos: number): string[] {
  const dias: string[] = []
  const ahora = Date.now()
  for (let i = 0; i < cuantos; i += 1) {
    dias.push(diaColombia(new Date(ahora - i * 24 * 60 * 60 * 1000)))
  }
  return dias
}

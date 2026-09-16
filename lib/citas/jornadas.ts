/**
 * La jornada HABITUAL de cada doctor, deducida de las horas a las que atiende.
 *
 * EL PROBLEMA QUE RESUELVE. El reporte del hospital no trae ninguna columna que
 * diga en que jornada trabaja cada quien, asi que todos los doctores entraban
 * como dia COMPLETO. En la parrilla eso significa que el medico que se va a las
 * once aparece tambien por la tarde, y que a alguien que a esa hora no esta en
 * el hospital se le puede citar un paciente a las tres. Sus horas si lo dicen, y
 * son el unico dato fiable que hay.
 *
 * QUE ES "HABITUAL" Y QUE NO ES. La jornada de un dia concreto NO se guarda
 * aqui ni en ninguna parte: se deduce de las citas de ese dia, que ya estan
 * guardadas (ver `jornadasDelDia` en el repositorio). El campo de la ficha es
 * otra cosa: lo que ese doctor suele hacer, y sirve para UN solo caso, el de
 * agendarle el primer paciente de un dia que todavia esta vacio. El mismo
 * medico hace el lunes completo, el martes solo la mañana y el miercoles no
 * viene; eso no cabe en un campo y no se intenta meter.
 *
 * Vive aparte de `importar-reporte` porque tiene DOS entradas: la carga diaria,
 * que la aplica sobre los dias que trae el archivo, y la pantalla de
 * Profesionales, desde donde el administrador la vuelve a pasar sobre el
 * periodo que elija.
 */
import { prisma } from '@/lib/prisma'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { diaColombia, horaColombia, jornadaSegunHoras } from '@/lib/turnos/tiempo'
import { errorDeNegocio } from '@/lib/turnos/errores'
import type { Jornada, ResumenRecalculo } from '@/lib/turnos/types'

/** Cuantos dias hacia atras se miran cuando no se dice otra cosa. */
const DIAS_POR_DEFECTO = 30

/** Tope de dias de un periodo, para no barrer la base entera de un clic. */
const MAXIMO_DIAS = 366

/**
 * Le pone a cada doctor la jornada habitual que dicen sus citas del periodo.
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
  /** Periodo a mirar, como alternativa a `fechas`. Ambos extremos incluidos. */
  desde?: string
  hasta?: string
  /** Doctores a revisar. Por defecto, todos los activos. */
  profesionalIds?: string[]
} = {}): Promise<ResumenRecalculo> {
  const fechas =
    opciones.fechas ??
    (opciones.desde && opciones.hasta
      ? diasEntre(opciones.desde, opciones.hasta)
      : ultimosDias(DIAS_POR_DEFECTO))

  const ordenadas = [...fechas].sort()
  const resumen: ResumenRecalculo = {
    desde: ordenadas[0] ?? '',
    hasta: ordenadas.at(-1) ?? '',
    diasMirados: fechas.length,
    doctoresRevisados: 0,
    sinCitas: 0,
    ajustes: [],
  }
  if (fechas.length === 0) return resumen

  const [configuracion, citas, doctores] = await Promise.all([
    turnoRepository.configuracion(),
    prisma.cita.findMany({
      where: {
        fecha: { in: fechas },
        estado: { not: 'CANCELADA' },
        ...(opciones.profesionalIds ? { profesionalId: { in: opciones.profesionalIds } } : {}),
      },
      select: { profesionalId: true, fecha: true, horaCita: true },
    }),
    prisma.profesional.findMany({
      where: opciones.profesionalIds ? { id: { in: opciones.profesionalIds } } : { activo: true },
      select: { id: true, nombre: true, jornada: true },
    }),
  ])
  resumen.doctoresRevisados = doctores.length

  // AGRUPADO POR DOCTOR **Y POR DIA**, no por doctor a secas.
  //
  // Juntando las horas de todo el periodo en un solo monton, el medico que
  // hace mañanas casi siempre y una sola tarde al mes salia de "dia completo":
  // basta una hora de cada lado para que la deduccion diga COMPLETA. Sobre
  // treinta dias eso acaba poniendo a todo el mundo en dia completo, que es
  // justo no decir nada. Deduciendo dia por dia y quedandose con lo que mas se
  // repite, "habitual" significa lo que de verdad significa.
  const porDoctor = new Map<string, Map<string, string[]>>()
  for (const cita of citas) {
    let porFecha = porDoctor.get(cita.profesionalId)
    if (!porFecha) {
      porFecha = new Map()
      porDoctor.set(cita.profesionalId, porFecha)
    }
    const horas = porFecha.get(cita.fecha)
    if (horas) horas.push(horaColombia(cita.horaCita))
    else porFecha.set(cita.fecha, [horaColombia(cita.horaCita)])
  }

  const porJornada = new Map<Jornada, string[]>()

  for (const doctor of doctores) {
    const porFecha = porDoctor.get(doctor.id)
    if (!porFecha || porFecha.size === 0) {
      resumen.sinCitas += 1
      continue
    }

    const veces = new Map<Jornada, number>()
    for (const horas of porFecha.values()) {
      const delDia = jornadaSegunHoras(horas, configuracion)
      if (delDia) veces.set(delDia, (veces.get(delDia) ?? 0) + 1)
    }

    const jornada = laQueMasSeRepite(veces)
    if (!jornada) {
      resumen.sinCitas += 1
      continue
    }
    if (jornada === doctor.jornada) continue

    const lista = porJornada.get(jornada)
    if (lista) lista.push(doctor.id)
    else porJornada.set(jornada, [doctor.id])

    resumen.ajustes.push({
      nombre: doctor.nombre,
      jornada,
      anterior: doctor.jornada,
      diasTrabajados: porFecha.size,
    })
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

  resumen.ajustes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return resumen
}

/**
 * La jornada que mas dias se repite.
 *
 * EN EL EMPATE GANA `COMPLETA`. El doctor que hace tantas mañanas como tardes
 * no es "de mañana": elegir una de las dos le cerraria la mitad de su agenda a
 * quien va a agendarle el primer paciente de un dia vacio, y este campo solo
 * se usa para eso. De mas a menos restrictivo, quedarse corto duele mas que
 * pasarse: la jornada del propio dia corrige en cuanto haya una cita.
 */
function laQueMasSeRepite(veces: Map<Jornada, number>): Jornada | null {
  let ganadora: Jornada | null = null
  let maximo = 0
  for (const [jornada, cuantas] of veces) {
    if (cuantas > maximo) {
      ganadora = jornada
      maximo = cuantas
    } else if (cuantas === maximo && jornada !== ganadora) {
      ganadora = 'COMPLETA'
    }
  }
  return ganadora
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

/** Todos los dias AAAA-MM-DD entre dos fechas, ambas incluidas. */
export function diasEntre(desde: string, hasta: string): string[] {
  const inicio = Date.parse(`${desde}T12:00:00Z`)
  const fin = Date.parse(`${hasta}T12:00:00Z`)
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) {
    errorDeNegocio('Las fechas del periodo no son validas.')
  }
  if (fin < inicio) errorDeNegocio('El periodo tiene que terminar despues de empezar.')

  const dias: string[] = []
  // Se avanza al MEDIODIA de cada dia, no a medianoche: sumando 24 h desde las
  // 00:00 un cambio de hora se salta un dia o repite el anterior.
  for (let t = inicio; t <= fin; t += 24 * 60 * 60 * 1000) {
    dias.push(new Date(t).toISOString().slice(0, 10))
    if (dias.length > MAXIMO_DIAS) {
      errorDeNegocio(`El periodo no puede pasar de ${MAXIMO_DIAS} dias. Elige un rango mas corto.`)
    }
  }
  return dias
}

/**
 * Purga de datos de pacientes: los dias viejos pierden el nombre y el
 * documento, y conservan todo lo demas.
 *
 * POR QUE ANONIMIZAR Y NO BORRAR LA FILA. La historia clinica del paciente
 * vive en SaludPlus; aqui no hace falta guardar su nombre pasados unos meses.
 * Pero borrar la fila entera se lleva por delante cosas que no son datos
 * personales y que este sistema si necesita mirar hacia atras:
 *
 * - La INASISTENCIA se mide comparando las citas del dia contra los turnos: el
 *   que no viene no genera turno, asi que solo existe en la cita. Sin citas, la
 *   inasistencia de todos los dias pasados queda en cero, que es un numero
 *   equivocado y no un numero que falte.
 * - La JORNADA DE UN DIA ("¿que trabajo este doctor el lunes?") y la jornada
 *   habitual se deducen de las citas de esos dias.
 * - El REGISTRO DE ACTIVIDAD guarda punteros (`citaId`, `profesionalId`,
 *   codigo del turno). Borrado lo que apuntan, queda una lista de ids que no
 *   resuelven contra nada: se conserva la forma del historial, no el historial.
 *
 * Vaciando solo las columnas personales no queda ni un dato de paciente y todo
 * lo anterior sigue siendo exacto. Ademas no hace falta ninguna migracion.
 *
 * NO ES UN EFECTO SECUNDARIO DE CARGAR LA AGENDA. Se dispara a mano, con su
 * propia confirmacion: la carga del hospital llega a media mañana, con
 * pacientes ya presentados, y un borrado automatico en ese momento es
 * exactamente cuando mas daño hace.
 */
import { prisma } from '@/lib/prisma'
import { errorDeNegocio } from '@/lib/turnos/errores'
import { ahoraISO, diaColombia, esFechaValida } from '@/lib/turnos/tiempo'

/**
 * Marca de una cita ya anonimizada.
 *
 * VA EN EL DOCUMENTO Y NO EN UN CAMPO NUEVO porque no hay ninguno, y va con el
 * id detras por una razon que no es cosmetica: `[fecha, documentoPaciente,
 * profesionalId, horaCita]` es UNICO. En el hospital hay dos pacientes citados
 * con el mismo doctor a la misma hora (pasa, y el sistema lo sostiene a
 * proposito); poniendoles a los dos el mismo documento, la segunda fila
 * chocaria contra el indice y la purga entera se caeria a la mitad. El id es
 * un cuid interno: no sale de ningun dato del paciente.
 */
const MARCA = 'ANON-'

/** Lo que se le deja escrito al nombre, para que se lea en pantalla. */
const NOMBRE_ANONIMO = 'Paciente anonimizado'

/** Meses que se conservan completos cuando no se dice otra cosa. */
export const MESES_CONSERVADOS = 6

/**
 * Minimo de meses que se pueden conservar.
 *
 * El recalculo de jornadas habituales mira el ultimo mes: con una ventana mas
 * corta que eso se estaria anonimizando lo que otra pantalla acaba de leer.
 * El nombre no le hace falta para deducir jornadas —solo las horas—, pero el
 * limite deja claro que por debajo de un mes no hay margen para nada.
 */
const MESES_MINIMOS = 1

/** Lo que una purga va a tocar (o toco). */
export interface ResumenPurga {
  /** Se anonimiza lo ANTERIOR a este dia; el dia en si no se toca. */
  limite: string
  /** Dias distintos con citas por anonimizar. */
  dias: number
  /** Citas que todavia tienen datos de paciente. */
  citas: number
  /** Turnos de esos dias que todavia guardan el nombre del paciente. */
  turnos: number
}

/**
 * El dia a partir del cual se conserva todo, contando hacia atras desde hoy.
 *
 * Se resta por MESES y no por dias porque es como lo piensa quien lo decide
 * ("seis meses"), y porque un mes no dura lo mismo en febrero que en marzo.
 */
export function limiteDeRetencion(meses = MESES_CONSERVADOS): string {
  if (!Number.isInteger(meses) || meses < MESES_MINIMOS) {
    errorDeNegocio(`Hay que conservar al menos ${MESES_MINIMOS} mes completo.`)
  }

  const hoy = diaColombia(ahoraISO())
  const [anio, mes, dia] = hoy.split('-').map(Number)
  // `Date.UTC` normaliza solo el desbordamiento de mes (mes 0 pasa a diciembre
  // del año anterior). El dia 31 en un mes de 30 se va al 1 del siguiente, que
  // es un dia de mas conservado: preferible a uno de menos.
  return new Date(Date.UTC(anio, mes - 1 - meses, dia)).toISOString().slice(0, 10)
}

/** Las filas que una purga con este limite tocaria. Solo cuenta, no escribe. */
export async function previsualizarPurga(limite: string): Promise<ResumenPurga> {
  const validado = validarLimite(limite)

  const [porDia, turnos] = await Promise.all([
    prisma.cita.groupBy({ by: ['fecha'], where: citasPorAnonimizar(validado), _count: { _all: true } }),
    prisma.turno.count({ where: turnosPorAnonimizar(validado) }),
  ])

  return {
    limite: validado,
    dias: porDia.length,
    citas: porDia.reduce((total, d) => total + d._count._all, 0),
    turnos,
  }
}

/**
 * Le quita el nombre y el documento a las citas anteriores al limite.
 *
 * Devuelve lo que de verdad toco, no lo que se preveia: entre la vista previa
 * y la confirmacion puede haberse cargado agenda, y lo que se apunte en el
 * registro de actividad tiene que ser lo que paso.
 *
 * Los turnos van en la MISMA transaccion. Guardan su propia copia del nombre
 * del paciente (la necesitan para las pantallas con sesion), asi que dejarlos
 * fuera seria anonimizar la mitad y creer que esta hecho.
 */
export async function purgarDatosDePacientes(limite: string): Promise<ResumenPurga> {
  const validado = validarLimite(limite)
  const previo = await previsualizarPurga(validado)

  // Una por una y no un `updateMany`: el documento anonimo lleva el id de cada
  // fila detras, por el indice unico (ver `MARCA`). Son cientos de filas por
  // dia purgado y esto se dispara a mano cada varios meses.
  const citas = await prisma.cita.findMany({
    where: citasPorAnonimizar(validado),
    select: { id: true },
  })

  let anonimizadas = 0
  // En bloques: una transaccion con decenas de miles de operaciones se queda
  // sin tiempo contra una base que esta al otro lado de internet, y un bloque
  // que falle deja los anteriores hechos, que es un estado valido (anonimizar
  // de menos se arregla repitiendo; no hay vuelta atras que perder).
  for (let i = 0; i < citas.length; i += 500) {
    const bloque = citas.slice(i, i + 500)
    await prisma.$transaction(
      bloque.map((cita) =>
        prisma.cita.update({
          where: { id: cita.id },
          data: {
            nombrePaciente: NOMBRE_ANONIMO,
            documentoPaciente: `${MARCA}${cita.id}`,
            tipoDocumento: null,
            procedimiento: null,
            cups: null,
          },
        }),
      ),
    )
    anonimizadas += bloque.length
  }

  const turnos = await prisma.turno.updateMany({
    where: turnosPorAnonimizar(validado),
    data: { nombrePaciente: NOMBRE_ANONIMO },
  })

  return { limite: validado, dias: previo.dias, citas: anonimizadas, turnos: turnos.count }
}

/**
 * El limite tiene que ser un dia pasado.
 *
 * NUNCA HOY NI EL FUTURO. Se anonimiza lo anterior al limite, asi que con el
 * limite en mañana entraria el dia de hoy: la agenda que se esta atendiendo en
 * ese momento, con pacientes en la sala esperando a que los llamen por su
 * nombre. Es la unica forma de que esto haga un destrozo, y por eso se corta
 * aqui y no solo en la pantalla.
 */
function validarLimite(limite: string): string {
  if (!esFechaValida(limite)) errorDeNegocio('La fecha limite no es valida.')

  const hoy = diaColombia(ahoraISO())
  if (limite > hoy) {
    errorDeNegocio(`El ${limite} no ha pasado todavia. Solo se pueden purgar dias ya cerrados.`)
  }
  if (limite === hoy) {
    errorDeNegocio('Hoy no se purga: es la agenda que se esta atendiendo ahora mismo.')
  }
  return limite
}

/** Citas anteriores al limite que todavia tienen datos de paciente. */
function citasPorAnonimizar(limite: string) {
  return {
    fecha: { lt: limite },
    // Las ya anonimizadas se saltan: asi repetir la purga no cuesta nada y el
    // resumen dice cuantas quedaban de verdad, no cuantas hay en el periodo.
    documentoPaciente: { not: { startsWith: MARCA } },
  }
}

/** Turnos anteriores al limite que todavia guardan el nombre del paciente. */
function turnosPorAnonimizar(limite: string) {
  return {
    fecha: { lt: limite },
    nombrePaciente: { not: null, notIn: [NOMBRE_ANONIMO] },
  }
}

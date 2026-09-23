/**
 * Preparacion de la simulacion de carga, TODA en el servidor.
 *
 * Antes la preparaba el navegador del administrador: por cada doctor pedia su
 * enlace, leia su consultorio, CREABA citas de relleno, registraba llegadas y
 * volvia a leer. Con diez doctores eran mas de cien viajes seguidos a la base,
 * y con la base remota el panel se quedaba en "Preparando..." sin avanzar
 * (y sin dejar pulsar "Siguiente para todos"). Aqui es una sola peticion.
 *
 * NO CREA CITAS NI PACIENTES. Usa las citas de hoy y, si no alcanzan para los
 * consultorios pedidos, trae las del ultimo dia de los doctores que hoy no
 * tienen (ver `traerCitasDelUltimoDia`).
 *
 * CADA DOCTOR EN SU CONSULTORIO REAL. Varios pueden compartir el mismo (un
 * salon con varios doctores): cada uno sale en su fila del televisor. Las
 * versiones anteriores creaban consultorios temporales ("CONS SIM ...");
 * al preparar o detener se borran los que hayan quedado.
 */
import type { TurnoRepository } from './repository'
import type { Cita, Modulo, Profesional } from './types'
import { ahoraISO, diaColombia } from './tiempo'

/** Tope de la simulacion: cuantos consultorios se pueden poner a llamar a la vez. */
export const MAXIMO_CONSULTORIOS_SIMULADOS = 20

/** Con que empezaban los consultorios temporales de versiones anteriores (se borran al limpiar). */
export const PREFIJO_CONSULTORIO_SIMULADO = 'CONS SIM '

/** Cuanto vive el enlace que se le genera a cada doctor simulado. */
const MINUTOS_DE_ACCESO = 120

export type DoctorPreparado = {
  profesionalId: string
  nombre: string
  moduloId: string
  moduloNombre: string
  token: string
  pacientesEnEspera: number
}

export type SimulacionPreparada = {
  doctores: DoctorPreparado[]
  /** De que dia salieron las citas: hoy, o el dia anterior que se trajo. */
  citasDe: string | null
  /** Lineas para el registro del panel: lo que se hizo y lo que fallo. */
  avisos: string[]
}

export type OpcionesDeSimulacion = {
  pacientesPorConsultorio: number
  /** Cuantos consultorios (doctores) llaman a la vez: lo que se quiere ver en la pantalla. */
  consultorios: number
}

/** Las citas por atender de cada doctor activo, en el orden en que empieza su dia. */
function citasPorDoctor(citas: Cita[], activos: Map<string, Profesional>): Map<string, Cita[]> {
  const grupos = new Map<string, Cita[]>()
  const ordenadas = [...citas].sort((a, b) => a.horaCita.localeCompare(b.horaCita))
  for (const cita of ordenadas) {
    if (cita.estado !== 'PROGRAMADA' || !activos.has(cita.profesionalId)) continue
    grupos.set(cita.profesionalId, [...(grupos.get(cita.profesionalId) ?? []), cita])
  }
  return grupos
}

/** Deja el dia en blanco y borra los consultorios temporales de una corrida anterior. */
export async function limpiarSimulacionDeCarga(repo: TurnoRepository): Promise<number> {
  await repo.reiniciarDatosDeHoy()
  return repo.eliminarConsultoriosDeSimulacion(PREFIJO_CONSULTORIO_SIMULADO)
}

/** Las citas por doctor de hoy; si no alcanzan, se traen las del ultimo dia de los que faltan. */
async function citasSuficientes(
  repo: TurnoRepository,
  hoy: string,
  activos: Map<string, Profesional>,
  consultorios: number,
  avisos: string[],
) {
  let grupos = citasPorDoctor(await repo.listarCitas({ fecha: hoy }), activos)
  let citasDe: string | null = grupos.size > 0 ? hoy : null
  if (grupos.size >= consultorios) return { grupos, citasDe }

  const traidas = await repo.traerCitasDelUltimoDia(hoy, [...grupos.keys()])
  if (traidas.desde) {
    avisos.push(`Hoy no alcanzaban las citas: se usan ${traidas.movidas} del ${traidas.desde}.`)
    citasDe = traidas.desde
    grupos = citasPorDoctor(await repo.listarCitas({ fecha: hoy }), activos)
  }
  return { grupos, citasDe }
}

export async function prepararSimulacionDeCarga(
  repo: TurnoRepository,
  { pacientesPorConsultorio, consultorios }: OpcionesDeSimulacion,
): Promise<SimulacionPreparada> {
  const avisos: string[] = []
  await limpiarSimulacionDeCarga(repo)
  const hoy = diaColombia(ahoraISO())

  const profesionales = await repo.listarProfesionales()
  const activos = new Map(profesionales.filter((p) => p.activo).map((p) => [p.id, p]))
  const { grupos: conCitas, citasDe } = await citasSuficientes(repo, hoy, activos, consultorios, avisos)

  const grupos = [...conCitas].slice(0, consultorios)
  if (grupos.length === 0) {
    avisos.push(
      'No hay citas por atender ni hoy ni en dias anteriores con doctores activos. ' +
        'Carga el reporte de citas (o agenda algunas) y vuelve a preparar.',
    )
    return { doctores: [], citasDe, avisos }
  }
  if (grupos.length < consultorios) {
    avisos.push(`Solo hay ${grupos.length} doctores activos con citas: se simulan ${grupos.length} consultorios.`)
  }

  // Cada doctor en SU consultorio real, como en el hospital: varios pueden
  // compartir el mismo (un salon con varios doctores) y cada uno sale en su
  // fila del televisor. Ya no hacen falta consultorios temporales.
  const modulos = (await repo.listarModulos()).filter((m) => m.activo)
  const consultoriosDe = new Map<string, Modulo | undefined>()
  for (const [profesionalId] of grupos) {
    const doctor = activos.get(profesionalId)!
    consultoriosDe.set(
      profesionalId,
      modulos.find((m) => m.id === doctor.moduloId) ?? modulos.find((m) => m.servicioId === doctor.servicioId) ?? modulos[0],
    )
  }

  /*
   * UNO POR UNO, NO EN PARALELO. Con la base del hospital (pool pequeño, a
   * veces de UNA conexion) quince doctores preparandose a la vez agotaban las
   * conexiones y la preparacion entera caia con "sistema ocupado". Y un doctor
   * que falla se salta con su aviso, sin tumbar a los demas.
   */
  const doctores: DoctorPreparado[] = []
  for (const [profesionalId, suyas] of grupos) {
    const profesional = activos.get(profesionalId)!
    try {
      for (const cita of suyas.slice(0, pacientesPorConsultorio)) {
        try {
          await repo.registrarLlegada(cita.id)
        } catch (error) {
          avisos.push(`No se pudo registrar la llegada de ${cita.nombrePaciente}: ${(error as Error).message}`)
        }
      }

      const { token } = await repo.crearAccesoProfesional(profesionalId, MINUTOS_DE_ACCESO)
      const pendientes = await repo.listarPendientes({ profesionalId })
      const modulo = consultoriosDe.get(profesionalId)
      doctores.push({
        profesionalId,
        nombre: profesional.nombre,
        moduloId: modulo?.id ?? '',
        moduloNombre: modulo?.nombre ?? '—',
        token,
        pacientesEnEspera: pendientes.length,
      })
    } catch (error) {
      avisos.push(`No se pudo preparar a ${profesional.nombre}: ${(error as Error).message}`)
    }
  }

  return { doctores, citasDe, avisos }
}

/**
 * Que consultorios se pintan en el televisor de la sala de espera.
 *
 * POR QUE NO BASTA CON QUE EL MODULO ESTE ACTIVO. El catalogo lo va llenando la
 * carga diaria del reporte del hospital: ahi todo entra activo y nada se vuelve
 * a apagar —y hace bien, porque un reporte filtrado por un doctor no puede
 * desactivar medio hospital—. La consecuencia es que `activo` acaba
 * significando "existe en el hospital" y no "hoy hay alguien ahi dentro". Con
 * ese criterio, el televisor mostraba veinte casillas para tres consultorios
 * que atienden, y el paciente tenia que buscar la suya entre diecisiete vacias.
 *
 * POR QUE ES UNA FUNCION PURA Y VIVE APARTE. Este criterio lo tienen que
 * cumplir IGUAL las dos implementaciones del repositorio. La primera vez se
 * escribio solo dentro de la de Postgres, y la de memoria se quedo mostrando
 * una casilla por modulo activo: dos comportamientos opuestos para el mismo
 * contrato, y —peor— la prueba que existia corria contra la de memoria, asi que
 * daba por bueno justo lo contrario de lo que hacia produccion. Aqui esta una
 * sola vez, sin base de datos delante, y se puede probar caso por caso.
 */
import type { CasillaPantalla } from './types'

export interface EntradaDePantalla {
  /** Consultorios y ventanillas ACTIVOS del catalogo. */
  modulos: Array<{ id: string; servicioId: string | null }>
  /**
   * Servicios que atienden por orden de llegada. Sus ventanillas no tienen
   * agenda que mirar.
   */
  serviciosDeVentanilla: Set<string>
  /** Modulos con al menos una cita hoy (cancelada no cuenta). */
  conCitasHoy: Set<string>
  /** Modulos desde los que ya se llamo un turno hoy. */
  conTurnosHoy: Set<string>
  /** Modulos con un doctor activo asignado. Es el respaldo de primera hora. */
  conProfesionalAsignado: Set<string>
  /**
   * Si el dia YA TIENE AGENDA CARGADA.
   *
   * Es "existe alguna cita registrada para hoy", CANCELADAS INCLUIDAS, y no
   * "hay citas vivas". La diferencia importa: con el segundo criterio, un dia
   * cuyas citas se cancelaran todas volvia a parecer un dia sin cargar, y el
   * respaldo se reencendia a media mañana devolviendo al televisor las casillas
   * de consultorios donde no hay nadie. Una cita cancelada sigue siendo prueba
   * de que la agenda del dia se subio.
   */
  hayAgendaDelDia: boolean
}

/**
 * Los modulos que se ven, en el orden en que llegaron.
 *
 * Trabaja hoy el consultorio que cumpla una de estas:
 *
 *   1. Es una VENTANILLA —servicio de fila compartida, o modulo sin servicio—.
 *      Atiende por orden de llegada, no tiene agenda que consultar, y son pocas
 *      y fijas. Esconderlas hasta el primer paciente dejaria el televisor en
 *      blanco a la hora de abrir, que se lee como que el sistema se cayo.
 *
 *   2. Tiene citas hoy, o ya se llamo un turno desde el. Es el caso normal
 *      durante la jornada, y es el que de verdad responde "hoy hay alguien
 *      ahi".
 *
 *   3. RESPALDO: si el dia TODAVIA NO TIENE NINGUNA AGENDA CARGADA, se muestran
 *      tambien los consultorios que tienen un doctor asignado. Sin esto, el
 *      televisor amanecia mostrando solo las ventanillas —los consultorios
 *      desaparecian enteros hasta que alguno llamara por primera vez—, porque
 *      la agenda se sube al abrir el hospital y antes de eso no hay ni una
 *      cita. En cuanto entra la agenda del dia, mandan las citas y el respaldo
 *      se apaga solo.
 */
export function modulosVisiblesEnPantalla(entrada: EntradaDePantalla): Set<string> {
  const visibles = new Set<string>()

  for (const modulo of entrada.modulos) {
    const esVentanilla = !modulo.servicioId || entrada.serviciosDeVentanilla.has(modulo.servicioId)

    if (
      esVentanilla ||
      entrada.conCitasHoy.has(modulo.id) ||
      entrada.conTurnosHoy.has(modulo.id) ||
      (!entrada.hayAgendaDelDia && entrada.conProfesionalAsignado.has(modulo.id))
    ) {
      visibles.add(modulo.id)
    }
  }

  return visibles
}

/**
 * El puesto de una casilla en el televisor: consultorio + doctor.
 *
 * Cualquier consultorio puede ser un salon grande con varios doctores
 * atendiendo a la vez, cada uno en su espacio y sin numero propio. El
 * televisor les da una fila a cada uno; sin doctor (una ventanilla), el
 * puesto es el consultorio.
 */
export function puestoDe(moduloId: string, profesionalId?: string | null): string {
  return profesionalId ? `${moduloId}~${profesionalId}` : moduloId
}

/**
 * La casilla libre de un consultorio, a partir de cualquiera de las suyas: sin
 * turno y sin puesto, como la manda el servidor cuando nadie atiende ahi.
 */
export function casillaLibreDe(casilla: CasillaPantalla): CasillaPantalla {
  return { ...casilla, puesto: undefined, codigo: null, horaLlamado: null, vecesLlamado: 0 }
}

/** La clave de una casilla en el televisor: su puesto o, si no lo trae, su consultorio. */
export function claveDeCasilla(casilla: { moduloId: string; puesto?: string }): string {
  return casilla.puesto ?? casilla.moduloId
}

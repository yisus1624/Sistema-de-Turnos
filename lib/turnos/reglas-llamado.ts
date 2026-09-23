/**
 * Reglas de "llamar al siguiente", compartidas por las dos implementaciones del
 * repositorio.
 *
 * EL PROBLEMA QUE RESUELVEN. Llamar al siguiente cierra solo al paciente
 * anterior. Con la red lenta, el servidor llamaba al paciente A, la respuesta
 * se perdia, y el doctor —viendo aun la pantalla vieja— volvia a pulsar: se
 * llamaba a B y A quedaba ATENDIDO sin haber entrado. Ahora el cliente declara
 * que turno cree tener abierto; si el real es otro, no se toca nada y se le
 * devuelve el estado verdadero (409).
 *
 * EL ALCANCE. Que turnos son "los mios" depende de quien llama: el doctor
 * atiende a sus pacientes (esten en el consultorio que esten); una ventanilla
 * atiende los que llamo ESE funcionario en ESE modulo. Con el mismo filtro se
 * busca el turno abierto, se cierra el anterior y se detecta si el modulo lo
 * esta usando otra persona: una sola definicion para las tres cosas.
 */
import { ConflictoDeTurno, errorDeNegocio } from './errores'
import type { FiltroTurnoAbierto, Modulo, Servicio, SolicitudDeLlamado, Turno } from './types'

export type { SolicitudDeLlamado } from './types'

export function alcanceDelLlamado(quien: SolicitudDeLlamado): FiltroTurnoAbierto {
  if (quien.profesionalId !== undefined) return { profesionalId: quien.profesionalId }
  return { moduloId: quien.moduloId, funcionarioId: quien.funcionarioId }
}

/**
 * La clave del candado de un llamado: lo que no pueden hacer dos peticiones a
 * la vez. El doctor puede estar en dos equipos y dos consultorios, asi que su
 * candado es EL, no el modulo; una ventanilla ya queda serializada por su
 * modulo.
 */
export function candadoDelAlcance(alcance: FiltroTurnoAbierto): string | null {
  return alcance.profesionalId !== undefined ? `llamar:profesional:${alcance.profesionalId}` : null
}

const CAMPOS_DEL_ALCANCE = ['profesionalId', 'moduloId', 'funcionarioId'] as const

type CamposDelAlcance = Pick<Turno, (typeof CAMPOS_DEL_ALCANCE)[number]>

/** Si el turno cumple TODOS los campos presentes del filtro. */
export function perteneceAlAlcance(turno: Partial<CamposDelAlcance>, filtro: FiltroTurnoAbierto): boolean {
  return CAMPOS_DEL_ALCANCE.every((campo) => filtro[campo] === undefined || turno[campo] === filtro[campo])
}

/**
 * Exige que el turno abierto real sea el que el cliente cree tener.
 *
 * `esperado` undefined solo lo reciben las pruebas del dominio, que no tienen
 * pantalla: el tipo `PeticionDeLlamado` lo exige a todo el codigo de la
 * aplicacion, y las rutas rechazan con un 400 la peticion que no lo trae. Si
 * el real ya no existe —se cerro por otro camino—, llamar es seguro: no queda
 * nadie a quien cerrar por detras.
 */
export function exigirTurnoAbiertoEsperado(real: Turno | null, esperado: string | null | undefined) {
  if (esperado === undefined || !real || real.id === esperado) return

  throw new ConflictoDeTurno(
    `El paciente del turno ${real.codigo} ya fue llamado y sigue en atencion. Cierralo o repitelo antes de llamar al siguiente.`,
    real,
  )
}

/**
 * Una ventanilla solo llama filas compartidas, y desde un modulo que sea de ese
 * servicio o generico.
 *
 * Sin esto, el operador podia mandar el servicio de consulta externa y
 * llevarse a los pacientes de los medicos, o elegir el consultorio de un doctor
 * y cerrarle en silencio al paciente que tuviera adentro.
 */
export function exigirVentanillaCompatible(
  servicio: Pick<Servicio, 'id' | 'nombre' | 'modoFila'>,
  modulo: Pick<Modulo, 'nombre' | 'servicioId'>,
) {
  if (servicio.modoFila !== 'COMPARTIDA') {
    errorDeNegocio(`${servicio.nombre} atiende por cita: a sus pacientes los llama su profesional desde su consultorio.`)
  }
  if (modulo.servicioId && modulo.servicioId !== servicio.id) {
    errorDeNegocio(`${modulo.nombre} no pertenece a ${servicio.nombre}. Elige una ventanilla de ese servicio.`)
  }
}

/**
 * El modulo lo tiene otra persona con un paciente adentro (409).
 *
 * `quien` es el nombre del profesional si el turno es de un doctor, o null si
 * lo llamo otra ventanilla.
 */
export function moduloOcupado(moduloNombre: string, quien: string | null, codigo: string): ConflictoDeTurno {
  return new ConflictoDeTurno(
    `${moduloNombre} lo esta usando ${quien ?? 'otro funcionario'} en este momento (turno ${codigo}).`,
  )
}

/** El ultimo llamado de una lista de turnos abiertos, o null. */
export function masRecienteLlamado(turnos: Turno[]): Turno | null {
  const hora = (turno: Turno) => Date.parse(turno.horaLlamado ?? '') || 0
  return turnos.reduce<Turno | null>((actual, turno) => (!actual || hora(turno) > hora(actual) ? turno : actual), null)
}

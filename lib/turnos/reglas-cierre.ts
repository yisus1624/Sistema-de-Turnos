/**
 * Que hacer cuando piden cerrar o repetir un turno, segun como este de verdad.
 *
 * VIVE APARTE DE LOS REPOSITORIOS porque es la misma regla en memoria y en
 * PostgreSQL, y estaba copiada en los dos (`exigirTurnoEnAtencion`). Contra la
 * base ademas se pregunta dos veces: antes de escribir y otra vez si la
 * escritura condicionada no afecto a ninguna fila (alguien cambio el turno en
 * medio). La respuesta tiene que ser identica en los tres sitios.
 *
 * POR QUE "YA APLICADA" Y NO UN ERROR. Con la red lenta, la respuesta de
 * "Atendido" se pierde aunque el servidor lo haya hecho; el funcionario vuelve
 * a pulsar. Antes recibia "ya esta cerrado", un error alarmante sobre algo que
 * salio bien. Ahora, si el turno ya esta en el estado pedido, es exito; solo si
 * esta en OTRO estado cerrado hay un conflicto real que contar.
 */
import { ConflictoDeTurno, errorDeNegocio } from './errores'
import type { EstadoTurno, Turno } from './types'

export type Desenlace = 'aplicar' | 'ya_aplicada'

export type EstadoDeCierre = Extract<EstadoTurno, 'ATENDIDO' | 'AUSENTE'>

type TurnoParaDecidir = Pick<Turno, 'codigo' | 'estado' | 'vecesLlamado' | 'cierreAutomatico'>

/** Los estados en los que un turno tiene a alguien delante. */
export const ESTADOS_ABIERTOS: readonly EstadoTurno[] = ['LLAMADO', 'EN_ATENCION']

export function estaAbierto(turno: Pick<Turno, 'estado'>): boolean {
  return ESTADOS_ABIERTOS.includes(turno.estado)
}

/** Como se nombra cada estado cerrado en los avisos. Una linea por estado nuevo. */
const NOMBRE_DEL_CIERRE: Partial<Record<EstadoTurno, string>> = {
  ATENDIDO: 'atendido',
  AUSENTE: 'ausente',
  CANCELADO: 'cancelado',
}

function comoSeCerro(turno: TurnoParaDecidir): string {
  const nombre = NOMBRE_DEL_CIERRE[turno.estado] ?? turno.estado.toLowerCase()
  return turno.cierreAutomatico ? `${nombre} automaticamente al llamar al siguiente` : nombre
}

function exigirQueFueLlamado(turno: TurnoParaDecidir) {
  if (turno.estado === 'EN_ESPERA') errorDeNegocio(`El turno ${turno.codigo} todavia no ha sido llamado.`)
}

export function decidirCierre(turno: TurnoParaDecidir, pedido: EstadoDeCierre): Desenlace {
  exigirQueFueLlamado(turno)
  if (estaAbierto(turno)) return 'aplicar'
  if (turno.estado === pedido) return 'ya_aplicada'

  throw new ConflictoDeTurno(
    `El turno ${turno.codigo} ya se cerro como ${comoSeCerro(turno)}; no se puede marcar como ${NOMBRE_DEL_CIERRE[pedido]}.`,
  )
}

/**
 * Repetir el llamado.
 *
 * `vecesLlamadoVisto` es el conteo que tenia la pantalla al pulsar. Si el
 * servidor ya va por delante, la repeticion ya se hizo (su respuesta se
 * perdio): se devuelve sin volver a sonar en la sala.
 */
export function decidirRepeticion(turno: TurnoParaDecidir, vecesLlamadoVisto?: number): Desenlace {
  exigirQueFueLlamado(turno)
  if (!estaAbierto(turno)) {
    throw new ConflictoDeTurno(`El turno ${turno.codigo} ya se cerro; no se puede volver a llamar.`)
  }
  // Distinto y no solo mayor: es la misma condicion con la que PostgreSQL
  // condiciona el update (`vecesLlamado = visto`), y las dos implementaciones
  // tienen que responder igual.
  const yaRepetido = vecesLlamadoVisto !== undefined && turno.vecesLlamado !== vecesLlamadoVisto
  return yaRepetido ? 'ya_aplicada' : 'aplicar'
}

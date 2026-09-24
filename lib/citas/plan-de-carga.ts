/**
 * Que hacer con cada fila del reporte del hospital: crearla, actualizarla u
 * omitirla.
 *
 * POR QUE VIVE APARTE Y ES PURO. Esta decision es la regla de mas riesgo de la
 * carga diaria —de ella dependen la idempotencia, que no se toque a un paciente
 * que ya llego, y que una fila repetida no se cuente dos veces— y hasta ahora no
 * tenia ni una prueba, porque estaba enredada dentro de un bucle que escribia en
 * la base con Prisma. Nada de lo que decide necesita una base de datos: le basta
 * con la fila del archivo y con la cita que ya hubiera guardada. Sacada a una
 * funcion sin dependencias, cada caso se puede fijar con una prueba, que es como
 * se hizo con `lib/turnos/casillas.ts` y `lib/turnos/actividad.ts`.
 *
 * LO QUE AQUI SE DECIDE Y LO QUE NO. Aqui se decide QUE hacer; escribirlo sigue
 * siendo trabajo de `importar-reporte.ts`, que es el unico que habla con la
 * base.
 */
import { normalizarDocumento } from '@/lib/turnos/documento'

/**
 * Como se identifica una cita entre la agenda del hospital y la nuestra.
 *
 * El documento va normalizado: las citas guardadas antes con otro formato
 * ("1.067.890.123") no se reescriben, y sin esto la carga no las reconoceria y
 * duplicaria al paciente.
 */
export function claveDeCita(
  fecha: string,
  documento: string,
  profesionalId: string,
  horaCitaIso: string,
) {
  return `${fecha}|${normalizarDocumento(documento)}|${profesionalId}|${horaCitaIso}`
}

/** Los campos de una cita que la carga puede corregir. */
export interface DatosDeCita {
  nombrePaciente: string
  tipoDocumento: string | null
  procedimiento: string | null
  cups: string | null
  servicioId: string
}

/** La cita que ya esta guardada, en lo que hace falta para decidir. */
export interface CitaGuardada extends DatosDeCita {
  id: string
  estado: string
}

export type DecisionDeCarga =
  | { accion: 'crear' }
  | { accion: 'actualizar'; id: string; datos: Partial<DatosDeCita> }
  | { accion: 'omitir'; motivo: MotivoDeOmision }

/**
 * Por que una fila correcta no se aplico.
 *
 * Se distinguen aunque las tres cuenten igual en el resumen: al revisar una
 * carga que "omitio 40", no es lo mismo que fueran 40 pacientes ya presentes
 * que 40 filas repetidas en el archivo.
 */
export type MotivoDeOmision = 'repetida_en_el_archivo' | 'sin_cambios' | 'paciente_ya_llego'

/**
 * Que hacer con una fila.
 *
 * `yaVista` es si esta misma cita ya aparecio antes EN ESTE ARCHIVO: el reporte
 * del hospital trae filas repetidas, y la segunda no es una cita nueva ni un
 * error, es la misma.
 */
export function decidirFila(params: {
  fila: DatosDeCita
  existente?: CitaGuardada
  yaVista: boolean
}): DecisionDeCarga {
  if (params.yaVista) return { accion: 'omitir', motivo: 'repetida_en_el_archivo' }

  if (!params.existente) return { accion: 'crear' }

  // EL PACIENTE YA LLEGO, YA LO ATENDIERON, O ALGUIEN CANCELO LA CITA AQUI.
  //
  // En los tres casos la carga NO manda. Reescribir la cita de alguien que ya
  // esta en la sala podria mandarlo a otra fila o dejarlo sin el turno que
  // tiene en la mano; y resucitar una cita cancelada aqui deshace una decision
  // que tomo una persona mirando al paciente.
  if (params.existente.estado !== 'PROGRAMADA') {
    return { accion: 'omitir', motivo: 'paciente_ya_llego' }
  }

  const datos = camposQueCambian(params.existente, params.fila)

  // Ya estaba igual: ni creada ni cambiada. Es EL CASO NORMAL cuando se vuelve
  // a subir el mismo archivo, y es lo que hace que subirlo dos veces sea
  // inofensivo.
  if (Object.keys(datos).length === 0) return { accion: 'omitir', motivo: 'sin_cambios' }

  return { accion: 'actualizar', id: params.existente.id, datos }
}

/**
 * Lo que la fila del archivo corrige de la cita guardada.
 *
 * Solo lo que de verdad difiere: escribir campos iguales marcaria la cita como
 * actualizada por la carga de hoy sin haber cambiado nada, y el resumen diria
 * que se corrigieron trescientas citas cada mañana.
 */
function camposQueCambian(existente: DatosDeCita, fila: DatosDeCita): Partial<DatosDeCita> {
  const datos: Partial<DatosDeCita> = {}

  if (existente.nombrePaciente !== fila.nombrePaciente) datos.nombrePaciente = fila.nombrePaciente
  if (existente.tipoDocumento !== fila.tipoDocumento) datos.tipoDocumento = fila.tipoDocumento
  if (existente.procedimiento !== fila.procedimiento) datos.procedimiento = fila.procedimiento
  if (existente.cups !== fila.cups) datos.cups = fila.cups
  if (existente.servicioId !== fila.servicioId) datos.servicioId = fila.servicioId

  return datos
}

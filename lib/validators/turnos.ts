/**
 * Esquemas de entrada de las rutas de turnos.
 *
 * Los ids viajan en el cuerpo o en la consulta y los escribe quien quiera: se
 * acotan de largo para que un valor desmedido no llegue a la base. El turno
 * que la pantalla cree ver es OBLIGATORIO en las rutas de llamar (ver
 * `turnoAbiertoIdSchema`); el conteo visto al repetir es opcional porque
 * repetir sin el solo suena una vez de mas, no cierra a nadie.
 */
import { z } from 'zod'
import { instalarMensajesEnEspanol } from '@/lib/validacion/mensajes-zod'

// Toda ruta de la API pasa por aqui: los mensajes de Zod sin texto propio salen en español.
instalarMensajesEnEspanol()

/** Largo maximo de un id (los de la base son cuid, de 25 caracteres). */
const LARGO_MAXIMO_ID = 64

export const idSchema = z.string().trim().min(1).max(LARGO_MAXIMO_ID)

/**
 * El turno que la pantalla cree tener abierto al pulsar "Llamar siguiente"
 * (null si ninguno). Ver `exigirTurnoAbiertoEsperado`.
 *
 * OBLIGATORIO, aunque sea null. Si faltara y se tolerara, una pestaña con el
 * codigo de antes de este cambio (abierta desde la mañana, sin recargar)
 * llamaria sin comprobacion y podria cerrar a un paciente por detras. Ver
 * `PIDE_RECARGAR`.
 */
export const turnoAbiertoIdSchema = idSchema.nullable()

/** Lo que se responde a una pantalla que no manda el turno que ve. */
export const PIDE_RECARGAR =
  'Esta pantalla esta desactualizada. Recarga la pagina (tecla F5) y vuelve a intentarlo.'

/** Si el cuerpo no declara el turno que ve la pantalla: es codigo viejo. */
export function faltaElTurnoVisto(cuerpo: unknown): boolean {
  return typeof cuerpo !== 'object' || cuerpo === null || !('turnoAbiertoId' in cuerpo)
}

/** El id de un turno en la ruta, acotado como cualquier otro id. */
export function idDeTurnoValido(id: string): string {
  const leido = idSchema.safeParse(id)
  if (!leido.success) throw Object.assign(new Error('El turno indicado no existe.'), { status: 404 })
  return leido.data
}

/**
 * El profesional que MUESTRA la pantalla del consultorio (ver
 * `exigirMismoProfesional`). Opcional a proposito: las pestañas abiertas con el
 * codigo de antes no lo mandan y tienen que seguir funcionando hasta que
 * recarguen. El valor se compara tal cual con el de la cookie, asi que no hace
 * falta acotarlo: cualquier otra cosa simplemente no coincide.
 */
export const profesionalVistoSchema = z.object({ profesionalId: z.unknown() })

/** Cuerpo de "Repetir": el conteo que tenia la pantalla. Ver `decidirRepeticion`. */
export const repetirSchema = z
  .object({ vecesLlamadoVisto: z.number().int().min(0).max(10_000).optional() })
  .nullable()

/** Lee el cuerpo JSON sin fallar si viene vacio o roto. */
export async function cuerpoJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null)
}

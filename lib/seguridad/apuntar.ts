/**
 * Escribir en el registro varios apuntes de UNA MISMA accion.
 *
 * Una accion puede dejar mas de un rastro: renombrar una cuenta y cambiarle la
 * contrasena en el mismo guardado son dos preguntas distintas que alguien va a
 * hacerle al registro despues, y en la pantalla de actividad se filtra por tipo
 * de evento. Lo que no cambia es quien lo hizo y desde donde, asi que la firma
 * se pone una sola vez aqui en lugar de repetirla en cada `registrarEvento`.
 *
 * Vive fuera de `registro.ts` para no hacerle crecer una responsabilidad mas:
 * alli esta el acceso a la base y el limite de intentos.
 */
import { registrarEvento } from './registro'
import type { EventoSeguridad } from './tipos'

/** Lo que aporta cada apunte; lo demas lo pone quien firma. */
export type Apunte = Pick<EventoSeguridad, 'tipo' | 'exito' | 'identificador' | 'detalle'>

/** Quien hizo la accion y desde donde. */
export interface Firma {
  usuarioId: string
  usuarioNombre: string | null
  ip: string | null
}

/**
 * HAY QUE ESPERARLA, por lo mismo que `registrarEvento`: si la peticion termina
 * antes, el apunte que se pierde es el de la accion que alguien tendra que
 * explicar.
 */
export async function registrarApuntes(apuntes: Apunte[], firma: Firma): Promise<void> {
  for (const apunte of apuntes) {
    await registrarEvento({ ...apunte, ...firma })
  }
}

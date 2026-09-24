/**
 * Seguridad basica del sistema (requerimiento seccion 17).
 *
 * Deja el "registro de actividades importantes". El limite de intentos de
 * inicio de sesion vive aparte, en `./limitador`.
 *
 * EL REGISTRO SE GUARDA EN LA BASE. Antes vivia en un arreglo en memoria del
 * proceso: se perdia entero en cada reinicio y en cada despliegue, y en un
 * servidor con varias instancias cada una llevaba su propia lista, asi que la
 * pantalla mostraba un trozo distinto segun a cual le tocara responder. Un
 * registro de auditoria que desaparece al reiniciar no sirve para lo que
 * existe: contestar quien hizo que, y cuando, semanas despues.
 *
 */
import { headers } from 'next/headers'
import { ipReenviadaPorElProxy } from './origen'
import type { EventoSeguridad } from './tipos'

// El limitador de intentos vive en `./limitador`; se reexporta aqui para
// quien ya lo importaba de este modulo.
export { limitarIntentos, limpiarIntentos, MAXIMO_INTENTOS_EN_MEMORIA } from './limitador'

export type { EventoSeguridad } from './tipos'

/**
 * Si hay un proxy de confianza delante de la aplicacion.
 *
 * La IP del cliente NO la ve Next.js: solo llega si el proxy la escribe en la
 * cabecera `X-Forwarded-For`. Y una cabecera la pone quien quiera: sin un proxy
 * delante que la SOBRESCRIBA, cualquiera puede mandar la suya e inventarse una
 * IP distinta en cada intento.
 *
 * Por eso hay que declararlo a mano, poniendo TURNOS_CONFIAR_PROXY=1 en el
 * entorno, y solo cuando de verdad haya un proxy inverso (nginx, Caddy,
 * Apache) que sea el UNICO camino hacia la aplicacion. Adivinarlo no se puede:
 * la peticion se ve igual venga del proxy o del atacante.
 */
export const confiarEnProxy = process.env.TURNOS_CONFIAR_PROXY === '1'

/**
 * Datos de la peticion para el registro y los limites de intentos.
 *
 * `ip` viene en null cuando no hay proxy declarado. Eso es a proposito y es mas
 * honesto que apuntar una IP inventada: antes se guardaba la de la cabecera tal
 * cual, asi que el registro de actividad mostraba como origen de un intento
 * fallido la IP que el propio atacante hubiera escrito, y el limite por IP se
 * saltaba cambiandola en cada peticion. Un dato que el atacante controla no
 * sirve ni para bloquear ni para investigar despues.
 *
 * Lo que de verdad frena la fuerza bruta es el limite POR USUARIO, que no
 * depende de esto.
 */
export async function contextoPeticion() {
  const cabeceras = await headers()
  const agente = cabeceras.get('user-agent')

  if (!confiarEnProxy) return { ip: null, agente }

  const ip = ipReenviadaPorElProxy(cabeceras.get('x-forwarded-for'), cabeceras.get('x-real-ip'))
  return { ip, agente }
}

/**
 * Deja constancia de una accion en el log del servidor.
 *
 * EL REGISTRO DE ACTIVIDAD YA NO SE GUARDA EN LA BASE, por decision del
 * hospital: no se consultaba y ocupaba espacio. Los fallos (accesos
 * rechazados, intentos de ingreso) se siguen anotando por consola, que es lo
 * que sirve para diagnosticar; los exitos no dejan rastro. La tabla
 * `eventos_seguridad` se conserva vacia: quitarla seria una migracion
 * destructiva y no hace falta.
 *
 * Sigue siendo `async` para no tocar a las decenas de rutas que la esperan.
 */
export async function registrarEvento(evento: Omit<EventoSeguridad, 'fecha'>) {
  if (!evento.exito) {
    console.warn('[seguridad]', evento.tipo, {
      identificador: evento.identificador,
      ip: evento.ip,
      ...evento.detalle,
    })
  }
}

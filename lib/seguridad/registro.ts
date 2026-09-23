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
import { prisma } from '@/lib/prisma'
import { esFechaValida, instanteDeFranja } from '@/lib/turnos/tiempo'
import { ipReenviadaPorElProxy } from './origen'
import type { EventoSeguridad, FiltroEventos } from './tipos'

// El limitador de intentos vive en `./limitador`; se reexporta aqui para
// quien ya lo importaba de este modulo.
export { limitarIntentos, limpiarIntentos, MAXIMO_INTENTOS_EN_MEMORIA } from './limitador'

export type { EventoSeguridad, FiltroEventos } from './tipos'

/**
 * Tope de lo que devuelve una consulta.
 *
 * El registro ya no se recorta al guardar —la base se queda con todo, que es
 * de lo que se trata—, asi que el limite solo protege a la pantalla de pedir
 * medio año de actividad en una sola tabla.
 */
const MAXIMO_POR_CONSULTA = 1000


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
 * Deja constancia de una accion.
 *
 * HAY QUE ESPERARLA. Es `async` porque escribe en la base, y quien la llama
 * tiene que hacer `await`: en un servidor sin estado la peticion puede
 * terminar antes de que salga la escritura, y el evento que se pierde es justo
 * el de la accion que alguien va a tener que explicar despues.
 *
 * NO TUMBA LA ACCION QUE AUDITA. Si la base falla al guardar el apunte, se
 * grita por consola con el evento entero —que al menos queda en el registro del
 * servidor— pero no se lanza el error: que no se pueda escribir la bitacora no
 * puede impedir que se registre la llegada de un paciente.
 */
export async function registrarEvento(evento: Omit<EventoSeguridad, 'fecha'>) {
  if (!evento.exito) {
    console.warn('[seguridad]', evento.tipo, {
      identificador: evento.identificador,
      ip: evento.ip,
      ...evento.detalle,
    })
  }

  try {
    await prisma.eventoSeguridad.create({
      data: {
        tipo: evento.tipo,
        exito: evento.exito,
        usuarioId: evento.usuarioId ?? null,
        usuarioNombre: evento.usuarioNombre ?? null,
        identificador: evento.identificador ?? null,
        ip: evento.ip ?? null,
        detalle: (evento.detalle ?? undefined) as never,
      },
    })
  } catch (error) {
    console.error('[seguridad] no se pudo guardar el evento', evento, error)
  }
}

const UN_DIA_MS = 24 * 60 * 60 * 1000

/**
 * Los dos extremos de un dia de Colombia, como instantes.
 *
 * La columna guarda un instante, no un dia. Comparando contra la medianoche
 * del servidor, un equipo en otra zona partiria los dias por donde no es y la
 * actividad de la tarde saldria fechada al dia siguiente.
 */
function rangoDelDia(dia: string) {
  const inicio = new Date(instanteDeFranja(dia, '00:00'))
  return { gte: inicio, lt: new Date(inicio.getTime() + UN_DIA_MS) }
}

/** Lee el registro, opcionalmente acotado a un dia, un tipo o solo los fallos. */
export async function listarEventos(filtro: FiltroEventos = {}): Promise<EventoSeguridad[]> {
  const limite = Math.min(Math.max(filtro.limite ?? 200, 1), MAXIMO_POR_CONSULTA)

  const filas = await prisma.eventoSeguridad.findMany({
    where: {
      ...(filtro.tipo ? { tipo: filtro.tipo } : {}),
      ...(filtro.soloFallidos ? { exito: false } : {}),
      ...(filtro.fecha && esFechaValida(filtro.fecha) ? { fecha: rangoDelDia(filtro.fecha) } : {}),
    },
    orderBy: { fecha: 'desc' },
    take: limite,
  })

  return filas.map((fila) => ({
    fecha: fila.fecha.toISOString(),
    tipo: fila.tipo,
    exito: fila.exito,
    usuarioId: fila.usuarioId,
    usuarioNombre: fila.usuarioNombre,
    identificador: fila.identificador,
    ip: fila.ip,
    detalle: (fila.detalle as Record<string, unknown> | null) ?? undefined,
  }))
}

/**
 * Los tipos de evento que hay guardados, para llenar el selector de la
 * pantalla.
 *
 * Se preguntan a la base y no se sacan de la pagina que se esta viendo: con
 * los tipos deducidos de los ultimos doscientos eventos, filtrar por "cita
 * cancelada" era imposible los dias en que no se habia cancelado ninguna
 * todavia, que es justo cuando se busca.
 */
export async function tiposDeEvento(): Promise<string[]> {
  const filas = await prisma.eventoSeguridad.findMany({
    distinct: ['tipo'],
    select: { tipo: true },
    orderBy: { tipo: 'asc' },
  })
  return filas.map((f) => f.tipo)
}

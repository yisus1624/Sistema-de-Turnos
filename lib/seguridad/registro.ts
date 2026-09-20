/**
 * Seguridad basica del sistema (requerimiento seccion 17).
 *
 * Cubre dos cosas: limitar los intentos de inicio de sesion y dejar un
 * "registro de actividades importantes".
 *
 * EL REGISTRO SE GUARDA EN LA BASE. Antes vivia en un arreglo en memoria del
 * proceso: se perdia entero en cada reinicio y en cada despliegue, y en un
 * servidor con varias instancias cada una llevaba su propia lista, asi que la
 * pantalla mostraba un trozo distinto segun a cual le tocara responder. Un
 * registro de auditoria que desaparece al reiniciar no sirve para lo que
 * existe: contestar quien hizo que, y cuando, semanas despues.
 *
 * El limite de intentos SI sigue en memoria, y ahi esta bien: es una ventana de
 * minutos contra la fuerza bruta, no un dato que haya que conservar.
 */
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { esFechaValida, instanteDeFranja } from '@/lib/turnos/tiempo'
import type { EventoSeguridad, FiltroEventos } from './tipos'

export type { EventoSeguridad, FiltroEventos } from './tipos'

/**
 * Tope de lo que devuelve una consulta.
 *
 * El registro ya no se recorta al guardar —la base se queda con todo, que es
 * de lo que se trata—, asi que el limite solo protege a la pantalla de pedir
 * medio año de actividad en una sola tabla.
 */
const MAXIMO_POR_CONSULTA = 1000

declare global {
  var __turnosIntentos: Map<string, { conteo: number; expiraEn: number }> | undefined
}

const intentos: Map<string, { conteo: number; expiraEn: number }> =
  globalThis.__turnosIntentos ?? new Map()

// Se guarda SIEMPRE, tambien en produccion. Antes solo en desarrollo, y eso
// dejaba el limite de intentos sin efecto donde de verdad importa: si Next
// evalua este modulo en otro contexto, el contador de intentos fallidos
// arranca de cero y la proteccion contra fuerza bruta del inicio de sesion
// deja de contar.
globalThis.__turnosIntentos = intentos

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

  const reenviado = cabeceras.get('x-forwarded-for')
  // El primero de la lista es el cliente; los siguientes son los proxies por
  // los que paso.
  const ip = reenviado?.split(',')[0]?.trim() || cabeceras.get('x-real-ip') || null

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

/**
 * Limita cuantas veces se puede repetir una accion por identificador dentro de
 * una ventana de tiempo. Evita fuerza bruta contra el inicio de sesion.
 */
/**
 * Purga las ventanas ya vencidas.
 *
 * Sin esto el mapa crece para siempre: una entrada por cada IP y por cada
 * usuario que alguna vez intento entrar. En un servidor que lleva meses
 * levantado eso es una fuga de memoria lenta pero segura.
 */
function purgarVencidos(ahora: number) {
  for (const [clave, ventana] of intentos) {
    if (ventana.expiraEn <= ahora) intentos.delete(clave)
  }
}

let ultimaPurga = 0

/**
 * Cuantas ventanas se guardan como maximo.
 *
 * SIN ESTE TECHO EL MAPA NO TIENE FONDO. La purga de arriba solo borra las
 * ventanas YA VENCIDAS, y como mucho cada sesenta segundos; dentro de la
 * ventana de cinco minutos las entradas se quedan. El problema es de donde
 * salen las claves: en el acceso del consultorio el identificador es el TOKEN
 * (ver `lib/turnos/acceso-consultorio.ts`), que lo elige quien hace la
 * peticion. Un bucle mandando tokens inventados a /api/consultorio/<token>
 * estrena una entrada por intento y se lleva la memoria del proceso por
 * delante, y con ella la pantalla de la sala de espera.
 *
 * Cincuenta mil ventanas son unos pocos megas y quedan muy por encima de
 * cualquier uso real: el hospital tiene decenas de funcionarios y de enlaces,
 * no decenas de miles. Si se llega a este numero, no es trabajo: es una
 * avalancha.
 */
export const MAXIMO_INTENTOS_EN_MEMORIA = 50_000

/**
 * Cuantas ventanas se tiran de golpe cuando el mapa se llena.
 *
 * Por tandas y no de una en una: liberar un 10% deja sitio para un buen rato,
 * en vez de pagar un barrido en cada peticion de la avalancha.
 */
const DESALOJO_POR_TANDA = MAXIMO_INTENTOS_EN_MEMORIA / 10

/**
 * Hace sitio cuando el mapa toca el techo.
 *
 * Primero purga lo vencido, que es gratis y suele bastar. Si despues sigue
 * lleno, se descartan las ventanas MAS ANTIGUAS (el `Map` conserva el orden de
 * insercion, asi que las primeras son las que llevan mas tiempo dentro).
 *
 * POR QUE DESCARTAR LAS VIEJAS Y NO RECHAZAR LA NUEVA. Rechazar la nueva
 * significa DEJAR DE CONTAR a partir de ese momento: al atacante le bastaria
 * llenar el mapa para que el siguiente identificador —por ejemplo el usuario
 * del administrador en el inicio de sesion— pasara sin limite. Descartando las
 * viejas, el limitador sigue vivo y se queda con lo reciente, que es donde
 * esta el ataque en curso; lo que se pierde son ventanas a punto de vencer de
 * todas formas.
 */
function hacerSitio(ahora: number) {
  purgarVencidos(ahora)
  ultimaPurga = ahora

  if (intentos.size < MAXIMO_INTENTOS_EN_MEMORIA) return

  let porDesalojar = DESALOJO_POR_TANDA
  for (const clave of intentos.keys()) {
    if (porDesalojar <= 0) return
    intentos.delete(clave)
    porDesalojar -= 1
  }
}

export function limitarIntentos(
  accion: string,
  identificador: string,
  limite: number,
  ventanaMs: number,
) {
  const clave = `${accion}:${identificador.trim().toLowerCase() || 'desconocido'}`
  const ahora = Date.now()

  // Barrido periodico, no en cada llamada: recorrer el mapa entero en cada
  // intento de login seria peor que la fuga que evita.
  if (ahora - ultimaPurga > 60_000) {
    purgarVencidos(ahora)
    ultimaPurga = ahora
  }

  const actual = intentos.get(clave)

  if (!actual || actual.expiraEn <= ahora) {
    if (intentos.size >= MAXIMO_INTENTOS_EN_MEMORIA) hacerSitio(ahora)
    intentos.set(clave, { conteo: 1, expiraEn: ahora + ventanaMs })
    return { permitido: true, reintentarEnSegundos: 0 }
  }

  actual.conteo += 1
  return {
    permitido: actual.conteo <= limite,
    reintentarEnSegundos: Math.max(1, Math.ceil((actual.expiraEn - ahora) / 1000)),
  }
}

/**
 * Borra la cuenta de intentos de un identificador. Se llama cuando la accion
 * SALE BIEN.
 *
 * Sin esto el limite contaba tambien los aciertos, asi que no medía "cuantas
 * veces han fallado" sino "cuantas veces se ha usado": un mostrador donde
 * varias personas entran con la misma cuenta se bloqueaba solo a media mañana,
 * sin que nadie hubiera escrito mal una contrasena. Contando unicamente los
 * fallos, el limite frena la fuerza bruta —que por definicion falla— y deja
 * trabajar a quien acierta.
 */
export function limpiarIntentos(accion: string, identificador: string) {
  intentos.delete(`${accion}:${identificador.trim().toLowerCase() || 'desconocido'}`)
}

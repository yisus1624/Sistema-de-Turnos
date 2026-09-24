'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  MS_SILENCIO_MAXIMO,
  RUTA_EVENTOS_EN_VIVO,
  esCambioDeDatos,
  interpretarMensaje,
} from '@/lib/realtime/canal'
import type { EventoTurno } from '@/lib/realtime/hub'
import { crearUltimaPeticion, type UltimaPeticion } from '@/lib/api/ultima-peticion'
import { crearLimitador, type Limitador } from '@/lib/api/limitador'
import {
  cargarConReintento,
  crearComprobacionPeriodica,
  crearReintento,
  esperaDeReintento,
  type Reintento,
  type ResultadoDeCarga,
} from '@/lib/api/reintento'
import { fechaTrasCambioDeDia } from '@/lib/api/cambio-de-dia'
import { hoyEnColombia, pedir } from '@/lib/api/cliente'
import type { Modulo, Profesional, Servicio } from '@/lib/turnos/types'

/**
 * Devuelve `valor`, pero solo despues de `ms` sin que vuelva a cambiar.
 *
 * Lo usan las pantallas que buscan solas al mover un filtro: sin este retraso,
 * escribir "A-025" en el campo de turno dispararia cinco consultas.
 */
export function useValorConRetraso<T>(valor: T, ms = 350): T {
  const [diferido, setDiferido] = useState(valor)

  useEffect(() => {
    const id = setTimeout(() => setDiferido(valor), ms)
    return () => clearTimeout(id)
  }, [valor, ms])

  return diferido
}

/**
 * Cuanto se espera antes de recargar por un evento, para juntar en una sola
 * recarga la rafaga de eventos que llegan casi al tiempo (a primera hora, diez
 * consultorios pasando paciente producian diez recargas seguidas para pintar
 * exactamente el mismo estado final).
 */
const MS_AGRUPAR_EVENTOS = 500

/** Como esta la conexion de eventos, para poder decirselo a quien mira. */
export type EstadoConexionEnVivo = 'en-vivo' | 'reconectando'

type CallbacksEnVivo = {
  recargar: () => void
  interesa?: (evento: EventoTurno) => boolean
  alEvento?: (evento: EventoTurno) => void
  alConectar?: () => void
}

type OpcionesRecargaEnVivo = {
  /** Que eventos disparan la recarga. Por defecto, todos. */
  interesa?: (evento: EventoTurno) => boolean
  /**
   * Cada evento de datos tal cual llega, antes de juntarlos en una recarga:
   * para la pantalla que tiene que reaccionar a un tipo concreto (recargar
   * los catalogos, por ejemplo) sin abrir una segunda conexion.
   */
  alEvento?: (evento: EventoTurno) => void
  /**
   * Cada vez que el canal (re)conecta, ademas de `recargar`: para lo que solo
   * se recarga con eventos concretos (los catalogos) y se pierde si ese evento
   * llego durante el corte.
   */
  alConectar?: () => void
  /** Se apaga mientras la pantalla no tenga sentido (sin servicio elegido, enlace vencido). */
  activo?: boolean
}

/**
 * Temporizador que se rearma: cada `rearmar()` reinicia la cuenta desde cero.
 *
 * Lo usan las dos esperas de este archivo, que son la misma mecanica: juntar
 * una rafaga de eventos en una sola recarga, y vigilar un silencio.
 */
function crearEsperaRearmable(ms: number, alCumplirse: () => void) {
  let temporizador: ReturnType<typeof setTimeout> | null = null

  const cancelar = () => {
    if (temporizador) clearTimeout(temporizador)
    temporizador = null
  }

  const rearmar = () => {
    cancelar()
    temporizador = setTimeout(() => {
      temporizador = null
      alCumplirse()
    }, ms)
  }

  // Arma solo si no hay una cuenta en curso: una sucesion de avisos (los
  // reintentos fallidos del navegador) no puede aplazar el plazo para siempre.
  const armarSiNoEsta = () => {
    if (!temporizador) rearmar()
  }

  return { rearmar, cancelar, armarSiNoEsta }
}

/**
 * Cuanto se espera antes de decir "reconectando" tras un corte del canal.
 *
 * El servidor cierra cada conexion cada pocos minutos a proposito (el
 * reciclado, ver `lib/realtime/conexion.ts`) y el navegador la reabre en un
 * segundo. Avisar en el acto ponia el semaforo en rojo en TODAS las pantallas
 * cada 4-6 minutos, y el personal aprendia a ignorarlo justo cuando importa.
 * Si en este rato no vuelve a abrir, entonces si es un corte y se avisa.
 */
const MS_GRACIA_RECONEXION = 4000

// La espera de reintento vive en `lib/api/reintento.ts`: la comparten el canal
// y el reintento de las cargas. Se reexporta para quien ya la importaba de aqui.
export { esperaDeReintento }

export type ManejoDeCanal = {
  alConectar: () => void
  alPerderse: () => void
  alCambiarLosDatos: (evento: EventoTurno) => void
}

/**
 * Conexion de eventos que SE VIGILA A SI MISMA.
 *
 * Un SSE puede morir en silencio: el NAT vence la sesion, un firewall se traga
 * los paquetes o el equipo salta de wifi y el socket queda a medias. El
 * navegador deja la conexion en `OPEN`, no llama nunca a `onerror`, y la
 * pantalla se queda verde con la fila congelada; el doctor llama al siguiente
 * sobre una lista vieja sin ninguna senal de que algo va mal.
 *
 * Por eso el vigia: es un temporizador LOCAL (no le pide nada al servidor) que
 * se rearma con cada mensaje recibido, incluido el latido del canal. Si se
 * cumple, es que no llega ni el latido, asi que la conexion se da por muerta y
 * se rehace; al reconectar, `alConectar` vuelve a poner los datos al dia.
 *
 * Se exporta para la pantalla publica del televisor, que no encaja en
 * `useRecargaEnVivo`: no recarga entera con cada evento, aplica CADA evento a
 * la casilla que le toca y hace sonar la campana. Necesita el mismo canal que
 * se vigila a si mismo —el televisor lleva dias encendido, es el caso mas
 * expuesto a que el SSE muera en silencio— pero no la recarga completa.
 */
export function crearCanalEnVivo(manejo: ManejoDeCanal) {
  let eventos: EventSource | null = null
  let intentosFallidos = 0
  let reintento: ReturnType<typeof setTimeout> | null = null

  const vigia = crearEsperaRearmable(MS_SILENCIO_MAXIMO, () => {
    manejo.alPerderse()
    reconectar()
  })
  const avisoDePerdida = crearEsperaRearmable(MS_GRACIA_RECONEXION, manejo.alPerderse)

  function cancelarReintento() {
    if (reintento) clearTimeout(reintento)
    reintento = null
  }

  function abrir() {
    const canal = new EventSource(RUTA_EVENTOS_EN_VIVO)
    canal.onopen = () => {
      intentosFallidos = 0
      avisoDePerdida.cancelar()
      vigia.rearmar()
      manejo.alConectar()
    }
    canal.onerror = () => {
      // Con gracia: el reciclado del servidor reabre en un segundo y no es un
      // corte (ver `MS_GRACIA_RECONEXION`).
      avisoDePerdida.armarSiNoEsta()
      // Ante un corte de red el navegador reintenta solo (`CONNECTING`). Pero
      // si el servidor contesto con error (502/503 al reiniciar o desplegar,
      // o el aforo lleno), `EventSource` se CIERRA PARA SIEMPRE y no vuelve a
      // intentarlo: la pantalla quedaba muda hasta que el vigia despertara,
      // mas de un minuto despues. Se reprograma aqui con espera creciente.
      if (canal.readyState === EventSource.CLOSED && eventos === canal && !reintento) {
        const espera = esperaDeReintento(intentosFallidos++)
        reintento = setTimeout(() => {
          reintento = null
          reconectar()
        }, espera)
      }
    }
    canal.onmessage = (mensaje: MessageEvent<string>) => {
      vigia.rearmar()
      const recibido = interpretarMensaje(mensaje.data)
      // El latido solo demuestra que el canal sigue vivo: no trae novedades.
      if (recibido && esCambioDeDatos(recibido)) manejo.alCambiarLosDatos(recibido)
    }
    eventos = canal
    vigia.rearmar()
  }

  function soltar() {
    vigia.cancelar()
    avisoDePerdida.cancelar()
    cancelarReintento()
    eventos?.close()
    eventos = null
  }

  function reconectar() {
    soltar()
    abrir()
  }

  /*
   * Al volver la red, o al volver la pestaña/el televisor a primer plano (salvapantallas,
   * otra entrada HDMI, equipo suspendido), no se espera al vigia: el socket
   * viejo casi seguro murio durante el hueco aunque el navegador diga `OPEN`.
   * Se rehace ya, y al abrir, `alConectar` pone los datos al dia.
   */
  const alVolverLaRed = () => {
    intentosFallidos = 0
    reconectar()
  }
  const alVolverAPrimerPlano = () => {
    if (document.visibilityState !== 'visible') return
    if (eventos?.readyState === EventSource.OPEN) manejo.alConectar()
    else alVolverLaRed()
  }
  window.addEventListener('online', alVolverLaRed)
  document.addEventListener('visibilitychange', alVolverAPrimerPlano)

  function cerrar() {
    window.removeEventListener('online', alVolverLaRed)
    document.removeEventListener('visibilitychange', alVolverAPrimerPlano)
    soltar()
  }

  abrir()
  return { cerrar }
}

/** Engancha el canal a la pantalla. Devuelve como soltarlo todo. */
function engancharRecargaEnVivo(
  ultimo: RefObject<CallbacksEnVivo>,
  avisarConexion: (estado: EstadoConexionEnVivo) => void,
): () => void {
  const resincronizar = () => ultimo.current.recargar()
  const agrupador = crearEsperaRearmable(MS_AGRUPAR_EVENTOS, resincronizar)
  const leInteresa = (evento: EventoTurno) => {
    const { interesa } = ultimo.current
    return !interesa || interesa(evento)
  }

  const canal = crearCanalEnVivo({
    // Al (re)conectar puede haberse perdido lo ocurrido durante el corte.
    alConectar: () => {
      avisarConexion('en-vivo')
      resincronizar()
      ultimo.current.alConectar?.()
    },
    alPerderse: () => avisarConexion('reconectando'),
    alCambiarLosDatos: (evento) => {
      ultimo.current.alEvento?.(evento)
      if (leInteresa(evento)) agrupador.rearmar()
    },
  })

  // Volver de un hueco (red, pestaña dormida) ya lo cubre el propio canal: se
  // rehace o se da por conectado, y `alConectar` resincroniza.
  return () => {
    agrupador.cancelar()
    canal.cerrar()
  }
}

/**
 * Mantiene una pantalla al dia recargando cuando el servidor avisa por SSE.
 *
 * EL RESPALDO ES POR EVENTO, NO POR RELOJ. Antes habia ademas un intervalo
 * fijo, y eso significa que cada consultorio y cada ventanilla abiertos golpean
 * al servidor cada pocos segundos aunque no pase absolutamente nada; con la
 * jornada entera abierta son miles de peticiones para no traer ninguna novedad.
 * El SSE ya es una conexion persistente que solo transmite cuando hay algo. Asi
 * que el hueco se cierra resincronizando en los momentos en que de verdad se
 * pudo perder algo: al (re)conectar, al volver la pestaña a primer plano, al
 * volver la red, y cuando el canal se queda mudo (ver `crearCanalEnVivo`).
 *
 * Devuelve el estado de la conexion para que la pantalla pueda mostrarlo: si el
 * doctor esta viendo datos viejos, tiene que saberlo.
 */
export function useRecargaEnVivo(
  recargar: () => void,
  opciones: OpcionesRecargaEnVivo = {},
): EstadoConexionEnVivo {
  const { activo = true, interesa, alEvento, alConectar } = opciones
  const [conexion, setConexion] = useState<EstadoConexionEnVivo>('reconectando')
  // Los callbacks se leen desde una ref para que un `interesa` escrito en linea
  // no vuelva a abrir la conexion SSE en cada render.
  const ultimo = useRef<CallbacksEnVivo>({ recargar, interesa, alEvento, alConectar })

  useEffect(() => {
    ultimo.current = { recargar, interesa, alEvento, alConectar }
  })

  useEffect(() => {
    if (!activo) return

    const soltar = engancharRecargaEnVivo(ultimo, setConexion)
    return () => {
      soltar()
      setConexion('reconectando')
    }
  }, [activo])

  return conexion
}

/**
 * "La ultima peticion gana" para las recargas de una pantalla (ver
 * `lib/api/ultima-peticion.ts`). La misma instancia en todos los renders, y la
 * peticion en curso se cancela al desmontar.
 */
export function useUltimaPeticion(): UltimaPeticion {
  const [peticiones] = useState(crearUltimaPeticion)
  useEffect(() => () => peticiones.cancelar(), [peticiones])
  return peticiones
}

/**
 * Como mucho una carga cada `msMinimo` (ver `lib/api/limitador.ts`): la misma
 * instancia en todos los renders, siempre con la `cargar` mas reciente, y lo
 * pendiente se cancela al desmontar.
 */
export function useLimitador(msMinimo: number, cargar: () => void): Limitador {
  const ultima = useRef(cargar)
  useEffect(() => {
    ultima.current = cargar
  })
  // Mismo patron que `useReintento`: se crea al montar y se entrega una
  // fachada estable, para no leer refs durante el render.
  const actual = useRef<Limitador | null>(null)
  useEffect(() => {
    const limitador = crearLimitador(msMinimo, () => ultima.current())
    actual.current = limitador
    return () => limitador.cancelar()
  }, [msMinimo])
  const [fachada] = useState<Limitador>(() => ({
    pedir: () => actual.current?.pedir(),
    cancelar: () => actual.current?.cancelar(),
  }))
  return fachada
}

/**
 * Reintento autonomo de una carga (ver `lib/api/reintento.ts`): la misma
 * instancia en todos los renders, y lo pendiente se cancela al desmontar.
 */
export function useReintento(): Reintento {
  // Uno NUEVO por montaje: `cancelar()` es definitivo, y en desarrollo React
  // monta, desmonta y vuelve a montar; reusar el cancelado dejaria la pantalla
  // sin reintento.
  const actual = useRef<Reintento | null>(null)
  useEffect(() => {
    const reintento = crearReintento()
    actual.current = reintento
    return () => reintento.cancelar()
  }, [])
  const [fachada] = useState<Reintento>(() => ({
    programar: (accion) => actual.current?.programar(accion),
    exito: () => actual.current?.exito(),
    cancelar: () => actual.current?.cancelar(),
  }))
  return fachada
}

/**
 * Una carga de pantalla que se reintenta sola si falla.
 *
 * `cargar` pinta lo que corresponda (datos o aviso) y LANZA si fallo; este
 * hook decide si reintentar: si el fallo es pasajero, vuelve a cargar con
 * espera creciente hasta lograrlo, sin depender de que llegue un evento del
 * canal. Un 401/403 no se reintenta (ver `esReintentable`).
 *
 * Devuelve la funcion con la que la pantalla recarga en todos lados (al
 * montar, en cada evento, tras cada accion), estable entre renders.
 */
export function useCargaConReintento(
  cargar: () => Promise<ResultadoDeCarga>,
  opciones: { omitirReintento?: () => boolean } = {},
): () => Promise<void> {
  const ultima = useRef({ cargar, omitir: opciones.omitirReintento })
  useEffect(() => {
    ultima.current = { cargar, omitir: opciones.omitirReintento }
  })

  const reintento = useReintento()

  const recargar = useCallback(async function recargarConReintento(): Promise<void> {
    await cargarConReintento(() => ultima.current.cargar(), reintento, () => {
      // Hay una accion en curso (el doctor esta llamando o cerrando): esa accion
      // recarga al terminar, y un reintento en medio le pisaria la pantalla.
      if (ultima.current.omitir?.()) return
      void recargarConReintento()
    })
  }, [reintento])

  return recargar
}

/**
 * Mientras `activo`, vuelve a llamar a `comprobar` cada tanto (ver
 * `crearComprobacionPeriodica`), siempre con la `comprobar` mas reciente. Lo
 * usa la pantalla del doctor con el enlace rechazado: un rechazo pasajero se
 * recupera solo en vez de dejarla en rojo hasta que alguien pulse F5.
 */
export function useComprobacionPeriodica(activo: boolean, comprobar: () => Promise<unknown>) {
  const ultima = useRef(comprobar)
  useEffect(() => {
    ultima.current = comprobar
  })

  useEffect(() => {
    if (!activo) return
    const comprobacion = crearComprobacionPeriodica(() => ultima.current())
    return () => comprobacion.detener()
  }, [activo])
}

/** Cada cuanto se mira si ya cambio el dia en Colombia. */
const MS_REVISAR_CAMBIO_DE_DIA = 60_000

/**
 * Hace que una fecha que estaba en "hoy" pase sola al dia siguiente a
 * medianoche (ver `fechaTrasCambioDeDia`). La fecha que se eligio a mano no se
 * toca.
 */
export function useFechaQueSigueAHoy(setFecha: (cambiar: (actual: string) => string) => void) {
  useEffect(() => {
    let hoy = hoyEnColombia()
    const id = setInterval(() => {
      const nuevo = hoyEnColombia()
      if (nuevo === hoy) return
      const anterior = hoy
      hoy = nuevo
      setFecha((actual) => fechaTrasCambioDeDia(actual, anterior, nuevo))
    }, MS_REVISAR_CAMBIO_DE_DIA)
    return () => clearInterval(id)
  }, [setFecha])
}

/**
 * Servicios y modulos para los filtros de las pantallas de consulta (reportes,
 * historico).
 *
 * Antes cada pantalla los pedia por su cuenta y un fallo se tragaba en silencio:
 * los selectores quedaban vacios y la tabla (y el PDF) ponian "—" como nombre
 * de cada consultorio, sin ningun aviso. Ahora se reintenta solo y `fallo`
 * dice si todavia no se pudieron cargar, para mostrarlo.
 */
export function useCatalogosDeTurnos() {
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])
  // Para poner nombre al medico de cada turno (reportes).
  const [profesionales, setProfesionales] = useState<Profesional[]>([])
  const [fallo, setFallo] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const [s, m, p] = await Promise.all([
        pedir<{ servicios: Servicio[] }>('/api/turnos/servicios'),
        pedir<{ modulos: Modulo[] }>('/api/turnos/modulos'),
        // Con los inactivos: un turno viejo puede ser de un medico ya dado de baja.
        pedir<{ profesionales: Profesional[] }>('/api/turnos/profesionales?todos=1'),
      ])
      setServicios(s.servicios)
      setModulos(m.modulos)
      setProfesionales(p.profesionales)
      setFallo(false)
    } catch (error) {
      setFallo(true)
      throw error
    }
  }, [])

  const recargar = useCargaConReintento(cargar)
  useEffect(() => {
    void recargar()
  }, [recargar])

  return { servicios, modulos, profesionales, fallo }
}

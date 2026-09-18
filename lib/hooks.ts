'use client'

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  MS_SILENCIO_MAXIMO,
  RUTA_EVENTOS_EN_VIVO,
  esCambioDeDatos,
  interpretarMensaje,
} from '@/lib/realtime/canal'
import type { EventoTurno } from '@/lib/realtime/hub'

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
}

type OpcionesRecargaEnVivo = {
  /** Que eventos disparan la recarga. Por defecto, todos. */
  interesa?: (evento: EventoTurno) => boolean
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

  return { rearmar, cancelar }
}

/**
 * Avisa cuando el navegador vuelve de un hueco en el que pudo perderse eventos:
 * la pestaña estaba dormida o el equipo suspendido, o se cayo la red.
 */
function alVolverDeUnHueco(resincronizar: () => void): () => void {
  const siEstaVisible = () => {
    if (document.visibilityState === 'visible') resincronizar()
  }

  document.addEventListener('visibilitychange', siEstaVisible)
  window.addEventListener('online', resincronizar)

  return () => {
    document.removeEventListener('visibilitychange', siEstaVisible)
    window.removeEventListener('online', resincronizar)
  }
}

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

  const vigia = crearEsperaRearmable(MS_SILENCIO_MAXIMO, () => {
    manejo.alPerderse()
    reconectar()
  })

  function abrir() {
    const canal = new EventSource(RUTA_EVENTOS_EN_VIVO)
    canal.onopen = () => {
      vigia.rearmar()
      manejo.alConectar()
    }
    canal.onerror = () => manejo.alPerderse()
    canal.onmessage = (mensaje: MessageEvent<string>) => {
      vigia.rearmar()
      const recibido = interpretarMensaje(mensaje.data)
      // El latido solo demuestra que el canal sigue vivo: no trae novedades.
      if (recibido && esCambioDeDatos(recibido)) manejo.alCambiarLosDatos(recibido)
    }
    eventos = canal
    vigia.rearmar()
  }

  function cerrar() {
    vigia.cancelar()
    eventos?.close()
    eventos = null
  }

  function reconectar() {
    cerrar()
    abrir()
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
    },
    alPerderse: () => avisarConexion('reconectando'),
    alCambiarLosDatos: (evento) => {
      if (leInteresa(evento)) agrupador.rearmar()
    },
  })

  const dejarDeEscuchar = alVolverDeUnHueco(resincronizar)

  return () => {
    dejarDeEscuchar()
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
  const { activo = true, interesa } = opciones
  const [conexion, setConexion] = useState<EstadoConexionEnVivo>('reconectando')
  // Los callbacks se leen desde una ref para que un `interesa` escrito en linea
  // no vuelva a abrir la conexion SSE en cada render.
  const ultimo = useRef<CallbacksEnVivo>({ recargar, interesa })

  useEffect(() => {
    ultimo.current = { recargar, interesa }
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

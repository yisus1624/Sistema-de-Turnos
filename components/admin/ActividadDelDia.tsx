'use client'

/**
 * "Ese dia": lo que un servicio o un consultorio movio en la fecha que se esta
 * mirando.
 *
 * POR QUE ES UNA COLUMNA Y NO UN FILTRO QUE ESCONDE. En administracion hace
 * falta poder llegar a lo que hoy no trabaja —para activarlo, renombrarlo o
 * corregirle el servicio—, asi que esconderlo dejaria la pantalla sin poder
 * hacer su trabajo. Lo que hacia falta era poder DISTINGUIRLO, y para eso basta
 * con decirlo en cada fila.
 *
 * "NO ATENDIO" ES UNA RESPUESTA, NO UN HUECO. Es el mismo criterio que la
 * columna equivalente de Profesionales: el servicio sin ni una cita ese dia no
 * atendio, y decirlo asi es justo lo que se vino a preguntar.
 */

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CalendarBlank } from '@phosphor-icons/react/dist/ssr'
import { Campo, Entrada } from '@/components/admin/Campos'
import { hoyEnColombia, pedir } from '@/lib/api/cliente'
import type { ActividadCatalogo, ActividadDelDia } from '@/lib/turnos/types'

/**
 * El dia que se esta mirando y lo que se movio ese dia.
 *
 * Lo comparten las pantallas de Servicios y de Modulos, que preguntan lo mismo
 * cambiando solo de que lado del catalogo. Estaba copiado palabra por palabra
 * en las dos —el estado, la peticion, el efecto— y eso no era solo repeticion:
 * el defecto de tratar un fallo de red como un "no atendio" tambien estaba
 * duplicado, y habia que arreglarlo dos veces. Aqui vive una sola vez.
 */
export function useActividadDelDia(cual: 'porServicio' | 'porModulo') {
  const [fecha, setFecha] = useState(hoyEnColombia)
  const [actividad, setActividad] = useState<Record<string, ActividadDelDia>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)

  const cargar = useCallback(
    async (dia: string) => {
      setCargando(true)
      try {
        const datos = await pedir<ActividadCatalogo>(`/api/turnos/catalogo/actividad?fecha=${dia}`)
        setActividad(datos[cual])
        setError(false)
      } catch {
        // Se marca el error en vez de dejar el mapa vacio: vacio significa
        // "nadie atendio", y eso seria afirmar algo que no se sabe.
        setActividad({})
        setError(true)
      } finally {
        setCargando(false)
      }
    },
    [cual],
  )

  useEffect(() => {
    cargar(fecha)
  }, [cargar, fecha])

  return {
    fecha,
    setFecha,
    actividad,
    cargando,
    error,
    /** El dia elegido todavia no ha llegado. */
    esFutura: fecha > hoyEnColombia(),
  }
}

export function CeldaActividad({
  actividad,
  cargando,
  error,
  esFutura,
}: {
  actividad?: ActividadDelDia
  cargando: boolean
  /** No se pudo consultar. Ver la nota de abajo: NO es lo mismo que "no atendio". */
  error?: boolean
  /** El dia elegido todavia no ha llegado: lo que hay es agenda, no trabajo hecho. */
  esFutura?: boolean
}) {
  if (cargando) return <span className="text-sm font-semibold text-slate-300">…</span>

  /*
    UN FALLO DE LA CONSULTA NO ES UNA RESPUESTA.
    La ausencia de dato se pintaba como "No atendio", y el estado de error
    dejaba el mapa vacio: ante un corte de red, el administrador leia que
    NINGUN servicio del hospital atendio ese dia, en firme y sin nada que le
    dijera que era mentira. Se distingue.
  */
  if (error) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge tone="amber">Sin dato</Badge>
        <span className="text-xs font-semibold text-slate-400">no se pudo consultar</span>
      </div>
    )
  }

  if (!actividad) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge tone="slate">{esFutura ? 'Sin agenda' : 'No atendio'}</Badge>
        <span className="text-xs font-semibold text-slate-400">
          {esFutura ? 'todavia sin citas' : 'sin citas ese dia'}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {/*
        Un dia que todavia no ha llegado no se anuncia como trabajo hecho: lo
        que hay son citas agendadas.
      */}
      <Badge tone={esFutura ? 'blue' : 'green'}>{esFutura ? 'Con agenda' : 'Atendio'}</Badge>
      <span className="text-xs font-semibold text-slate-400">
        {actividad.citas} cita(s) · {actividad.desde}–{actividad.hasta}
      </span>
    </div>
  )
}

/**
 * El selector del dia que se esta mirando.
 *
 * Arranca en HOY siempre, porque la pregunta normal es por hoy, pero se mueve:
 * el administrador tambien necesita poder mirar hacia atras —"el martes
 * atendimos odontologia y consulta externa, hoy solo odontologia"— y sin poder
 * cambiar la fecha la tabla solo sabria contestar por el dia de hoy.
 */
export function SelectorDeDia({
  fecha,
  onFecha,
  ayuda,
}: {
  fecha: string
  onFecha: (fecha: string) => void
  ayuda: string
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Campo etiqueta="Dia" className="w-44">
        <Entrada type="date" value={fecha} onChange={(e) => onFecha(e.target.value)} />
      </Campo>
      {fecha !== hoyEnColombia() ? (
        <Button variant="secondary" size="sm" onClick={() => onFecha(hoyEnColombia())}>
          <CalendarBlank size={16} weight="bold" />
          Hoy
        </Button>
      ) : null}
      <p className="pb-2 text-xs leading-5 text-slate-500">{ayuda}</p>
    </div>
  )
}

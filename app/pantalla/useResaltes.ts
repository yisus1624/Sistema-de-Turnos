'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MS_NUEVO, MS_RESALTE, SIN_RESALTES, type Resaltes } from '@/lib/turnos/pantalla-tv'

type Temporizadores = Map<string, ReturnType<typeof setTimeout>>

/**
 * Los llamados recientes del televisor, CADA UNO CON SU PROPIO RELOJ.
 *
 * Antes habia un solo resalte: si tres doctores llamaban casi a la vez, el
 * resalte saltaba de fila en fila y solo el ultimo quedaba marcado; los otros
 * dos pacientes no alcanzaban a ver que les tocaba. Ahora cada llamado se
 * resalta `MS_RESALTE` y lleva la etiqueta "NUEVO" `MS_NUEVO`, sin apagar a
 * los demas: con cuatro llamados seguidos, las cuatro filas se ven marcadas a
 * la vez. Si el mismo puesto vuelve a llamar, su reloj arranca de nuevo.
 *
 * Son temporizadores por fila y no un reloj que late cada segundo: la tabla
 * solo se vuelve a pintar cuando un resalte empieza o se apaga.
 */
export function useResaltes(): { resaltes: Resaltes; resaltar: (clave: string) => void } {
  const [resaltes, setResaltes] = useState<Resaltes>(SIN_RESALTES)
  const deResalte = useRef<Temporizadores>(new Map())
  const deNuevo = useRef<Temporizadores>(new Map())

  const quitar = useCallback((campo: 'resaltados' | 'nuevos', clave: string) => {
    setResaltes((actual) => {
      if (!actual[campo].has(clave)) return actual
      const conjunto = new Set(actual[campo])
      conjunto.delete(clave)
      return { ...actual, [campo]: conjunto }
    })
  }, [])

  const programar = useCallback(
    (temporizadores: Temporizadores, clave: string, ms: number, campo: 'resaltados' | 'nuevos') => {
      const previo = temporizadores.get(clave)
      if (previo) clearTimeout(previo)
      temporizadores.set(
        clave,
        setTimeout(() => {
          temporizadores.delete(clave)
          quitar(campo, clave)
        }, ms),
      )
    },
    [quitar],
  )

  const resaltar = useCallback(
    (clave: string) => {
      setResaltes((actual) => ({
        ultimo: clave,
        resaltados: new Set(actual.resaltados).add(clave),
        nuevos: new Set(actual.nuevos).add(clave),
      }))
      programar(deResalte.current, clave, MS_RESALTE, 'resaltados')
      programar(deNuevo.current, clave, MS_NUEVO, 'nuevos')
    },
    [programar],
  )

  useEffect(() => {
    const resalte = deResalte.current
    const nuevo = deNuevo.current
    return () => {
      for (const temporizador of [...resalte.values(), ...nuevo.values()]) clearTimeout(temporizador)
      resalte.clear()
      nuevo.clear()
    }
  }, [])

  return { resaltes, resaltar }
}

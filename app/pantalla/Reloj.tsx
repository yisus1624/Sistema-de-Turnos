'use client'

import { useEffect, useState } from 'react'
import { Clock } from '@phosphor-icons/react/dist/ssr'

/**
 * La hora actual, refrescada cada quince segundos.
 *
 * Vive aparte del `Reloj` porque los DOS diseños de pantalla la necesitan —la
 * cuadricula la pinta abajo a la derecha y la cartelera arriba— y tener dos
 * temporizadores para el mismo dato significa que, con un televisor encendido
 * toda la jornada, los dos acaban marcando minutos distintos.
 *
 * Arranca en `null` a proposito: la hora del servidor y la del televisor no
 * tienen por que coincidir, y pintarla antes de que monte el componente haria
 * que React se quejara de que el HTML del servidor no cuadra con el del
 * navegador.
 */
export function useAhora() {
  const [ahora, setAhora] = useState<Date | null>(null)

  useEffect(() => {
    setAhora(new Date())
    const id = setInterval(() => setAhora(new Date()), 15000)
    return () => clearInterval(id)
  }, [])

  return ahora
}

/** La hora en formato "HH:MM", en hora de Colombia. */
export function horaColombiana(ahora: Date) {
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(ahora)
}

export default function Reloj() {
  const ahora = useAhora()

  if (!ahora) return null

  const hora = horaColombiana(ahora)
  const fecha = new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(ahora)

  return (
    <div className="flex items-center gap-3">
      <Clock size="2.4rem" weight="thin" className="text-slate-500" />
      <div className="leading-tight">
        <p className="text-2xl font-semibold tabular-nums tracking-[-0.01em] text-slate-700">{hora}</p>
        <p className="text-sm font-bold text-slate-500">{fecha}</p>
      </div>
    </div>
  )
}

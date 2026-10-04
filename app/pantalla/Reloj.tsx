'use client'

import { useEffect, useState } from 'react'

/**
 * La hora actual, refrescada cada quince segundos. La cartelera la recibe ya
 * formateada desde la pagina, que tiene un solo temporizador para todo.
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

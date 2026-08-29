'use client'

import { useEffect, useState } from 'react'

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

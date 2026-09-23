'use client'

/**
 * Lo que la pantalla necesita del navegador para repartir las casillas: el
 * espacio REAL que tiene (medido, no supuesto) y, si no caben todas con letra
 * legible, que pagina toca mostrar ahora. El calculo en si es puro y vive en
 * `lib/turnos/distribucion-pantalla.ts`.
 */
import { useCallback, useEffect, useState } from 'react'
import { decidirPagina, type EstadoDePagina, type Espacio } from '@/lib/turnos/distribucion-pantalla'
import { MS_RESALTE } from '@/lib/turnos/pantalla-tv'

/**
 * Mide el elemento y lo vuelve a medir cada vez que cambia de tamaño
 * (pantalla completa, otro televisor, girar el monitor). Devuelve el espacio y
 * la referencia que hay que ponerle al elemento.
 */
export function useEspacioMedido(): [Espacio, (elemento: HTMLElement | null) => void] {
  const [espacio, setEspacio] = useState<Espacio>({ ancho: 0, alto: 0 })
  const [elemento, setElemento] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!elemento) return
    const medir = () => setEspacio({ ancho: elemento.clientWidth, alto: elemento.clientHeight })
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(elemento)
    return () => observador.disconnect()
  }, [elemento])

  const referencia = useCallback((nuevo: HTMLElement | null) => setElemento(nuevo), [])
  return [espacio, referencia]
}

/**
 * Cada cuanto pasa de pagina cuando no caben todas: tiempo de sobra para que
 * alguien que busca su turno lo encuentre antes de que cambie.
 */
const MS_POR_PAGINA = 10_000

/** El consultorio recien llamado y en que pagina esta. */
export interface LlamadoEnPagina {
  clave: string
  pagina: number
}

/**
 * La pagina que toca mostrar: rota sola si hay mas de una, y salta a la del
 * consultorio que acaba de llamar (ver `decidirPagina`).
 */
export function usePaginaRotativa(paginas: number, llamado: LlamadoEnPagina | null): number {
  const [estado, setEstado] = useState<EstadoDePagina>({ pagina: 0, cambioEn: Number.POSITIVE_INFINITY })
  const claveLlamado = llamado?.clave ?? null
  const paginaLlamado = llamado?.pagina ?? 0

  // Llego un llamado: a su pagina, en el acto.
  useEffect(() => {
    if (claveLlamado === null) return
    setEstado((actual) =>
      decidirPagina(actual, {
        paginas,
        ahora: Date.now(),
        msPorPagina: MS_POR_PAGINA,
        llamado: { pagina: paginaLlamado, retenerMs: MS_RESALTE },
      }),
    )
  }, [claveLlamado, paginaLlamado, paginas])

  // La rotacion: espera hasta `cambioEn` (o la primera cuenta, si recien hay
  // varias paginas) y pasa a la siguiente.
  useEffect(() => {
    if (paginas <= 1) return
    const espera = Number.isFinite(estado.cambioEn) ? Math.max(0, estado.cambioEn - Date.now()) : MS_POR_PAGINA
    // Al dispararse, toca cambiar aunque el temporizador llegue un milisegundo
    // antes de `cambioEn`: por eso se acota a "ahora".
    const id = setTimeout(
      () => setEstado((actual) => decidirPagina({ ...actual, cambioEn: Math.min(actual.cambioEn, Date.now()) }, { paginas, ahora: Date.now(), msPorPagina: MS_POR_PAGINA })),
      espera,
    )
    return () => clearTimeout(id)
  }, [estado, paginas])

  // Si ahora hay menos paginas (se libero un consultorio), no se queda en una
  // que ya no existe.
  return paginas <= 1 ? 0 : estado.pagina % paginas
}

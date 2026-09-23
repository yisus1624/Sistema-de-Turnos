'use client'

/**
 * "1/2" en la esquina cuando las casillas no caben en una sola pantalla y
 * rotan. Sin el, quien busca su turno y no lo ve cree que no esta, en vez de
 * esperar a la siguiente pagina.
 */
export default function IndicadorDePagina({ actual, total }: { actual: number; total: number }) {
  if (total <= 1) return null
  return (
    <p
      className="absolute bottom-2 right-2 rounded-full bg-brand-950/85 px-4 py-1.5 text-lg font-bold tabular-nums text-white"
      aria-live="polite"
    >
      {actual + 1}/{total}
    </p>
  )
}

'use client'

/**
 * La barra de paginacion de las tablas: cuantos registros por pagina (10, 20
 * o 50) y los botones para moverse. La cuenta esta en `lib/paginacion`.
 *
 * Uso:
 *   const pagina = usePaginacion(filtrados, [busqueda, filtro])
 *   ...pagina.visibles.map(...)
 *   <Paginacion {...pagina} />
 */
import { useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { numerosDePagina, paginar, TAMANOS_DE_PAGINA, type Pagina } from '@/lib/paginacion'

export interface Paginado<T> extends Pagina<T> {
  cantidad: number
  porPagina: number
  irA: (pagina: number) => void
  cambiarPorPagina: (porPagina: number) => void
}

/**
 * Pagina `lista`. `reinicio` son los filtros de la tabla: cuando cambian se
 * vuelve a la pagina 1 (quedarse en la 4 de un resultado nuevo confunde). Se
 * compara en el render, sin efecto, por el mismo parpadeo que `paginar` evita.
 */
export function usePaginacion<T>(lista: readonly T[], reinicio: readonly unknown[] = []): Paginado<T> {
  const [porPagina, setPorPagina] = useState<number>(TAMANOS_DE_PAGINA[0])
  const [pagina, setPagina] = useState(1)
  const clave = JSON.stringify(reinicio)
  const [claveAnterior, setClaveAnterior] = useState(clave)
  if (clave !== claveAnterior) {
    setClaveAnterior(clave)
    setPagina(1)
  }
  return {
    ...paginar(lista, pagina, porPagina),
    cantidad: lista.length,
    porPagina,
    irA: setPagina,
    cambiarPorPagina: (tamano) => {
      setPorPagina(tamano)
      setPagina(1)
    },
  }
}

const BOTON =
  'grid h-9 min-w-9 place-items-center rounded-xl px-2 text-xs font-semibold tabular-nums transition-colors duration-[var(--suave)]'
const BOTON_NORMAL = 'border border-slate-200/70 text-slate-600 hover:bg-slate-50 hover:text-acento-600'
const BOTON_APAGADO = 'disabled:cursor-not-allowed disabled:opacity-40'

export function Paginacion<T>({ cantidad, porPagina, actual, total, desde, hasta, irA, cambiarPorPagina }: Paginado<T>) {
  // Solo aparece cuando hay algo que paginar.
  if (cantidad <= TAMANOS_DE_PAGINA[0]) return null
  return (
    <nav
      aria-label="Paginacion"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-slate-500">
        <label className="flex items-center gap-2">
          Mostrar
          {/*
            Un `select` suelto y no el `Seleccion` de la casa: ese mide 44px de
            alto, lo de un formulario, y en esta barra se come la fila.
          */}
          <select
            value={String(porPagina)}
            onChange={(e) => cambiarPorPagina(Number(e.target.value))}
            aria-label="Registros por pagina"
            className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold tabular-nums text-brand-950 outline-none transition focus:border-acento-400"
          >
            {TAMANOS_DE_PAGINA.map((tamano) => (
              <option key={tamano} value={tamano}>
                {tamano}
              </option>
            ))}
          </select>
          por pagina
        </label>
        <span className="tabular-nums" aria-live="polite">
          {desde}–{hasta} de {cantidad}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => irA(actual - 1)}
          disabled={actual === 1}
          aria-label="Pagina anterior"
          className={`${BOTON} ${BOTON_NORMAL} ${BOTON_APAGADO} w-9 px-0`}
        >
          <CaretLeft size={14} weight="bold" />
        </button>

        {numerosDePagina(actual, total).map((numero, i) =>
          numero === '…' ? (
            <span key={`hueco-${i}`} aria-hidden className="px-1 text-xs text-slate-400">
              …
            </span>
          ) : (
            <button
              key={numero}
              type="button"
              onClick={() => irA(numero)}
              aria-label={`Pagina ${numero}`}
              aria-current={numero === actual ? 'page' : undefined}
              className={`${BOTON} ${numero === actual ? 'bg-acento-600 text-white' : BOTON_NORMAL}`}
            >
              {numero}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => irA(actual + 1)}
          disabled={actual === total}
          aria-label="Pagina siguiente"
          className={`${BOTON} ${BOTON_NORMAL} ${BOTON_APAGADO} w-9 px-0`}
        >
          <CaretRight size={14} weight="bold" />
        </button>
      </div>
    </nav>
  )
}

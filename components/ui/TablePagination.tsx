'use client'

import { useId } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { cn } from '@/lib/ui'

type TablePaginationProps = {
  page: number
  pageSize: number
  total: number
  shown: number
  label?: string
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  pageSizeOptions?: number[]
  className?: string
}

export default function TablePagination({
  page,
  pageSize,
  total,
  shown,
  label = 'registros',
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  className,
}: TablePaginationProps) {
  const selectId = useId()
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const first = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const last = total === 0 ? 0 : Math.min(total, first + shown - 1)

  return (
    <div className={cn('flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-xs font-semibold text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-5', className)}>
      <span className="text-center sm:text-left">Mostrando {first} a {last} de {total} {label}</span>
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          className="inline-flex h-9 min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
        >
          <CaretLeft size={15} /> Anterior
        </button>
        <span className="whitespace-nowrap text-center text-xs font-semibold text-slate-700 sm:min-w-20">Página {safePage} de {totalPages}</span>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
          className="inline-flex h-9 min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
        >
          Siguiente <CaretRight size={15} />
        </button>
        <label className="sr-only" htmlFor={selectId}>Registros por página</label>
        <select
          id={selectId}
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="col-span-3 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:col-auto sm:w-auto"
        >
          {pageSizeOptions.map((size) => <option key={size} value={size}>{size} por página</option>)}
        </select>
      </div>
    </div>
  )
}

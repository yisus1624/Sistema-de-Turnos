import { ClipboardText } from '@phosphor-icons/react/dist/ssr'
import EmptyState from './EmptyState'
import TablePagination from './TablePagination'
import { cn } from '@/lib/ui'

export type DataTableColumn<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  className?: string
}

type DataTableProps<T> = {
  columns: Array<DataTableColumn<T>>
  data: T[]
  getRowKey: (row: T) => string
  emptyTitle?: string
  emptyDescription?: string
  page?: number
  pageSize?: number
  total?: number
  paginationLabel?: string
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
}

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  emptyTitle = 'Sin registros',
  emptyDescription = 'Cuando agregues informacion, aparecera en esta tabla.',
  page,
  pageSize,
  total,
  paginationLabel,
  onPageChange,
  onPageSizeChange,
}: DataTableProps<T>) {
  if (data.length === 0) {
    return <EmptyState icon={ClipboardText} title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="divide-y divide-slate-100 md:hidden">
        {data.map((row) => (
          <div key={getRowKey(row)} className="space-y-3 p-4">
            {columns.map((column, index) => (
              <div key={column.key} className={cn(index === 0 ? 'block' : 'flex items-start justify-between gap-4')}>
                <span className={cn('text-[11px] font-black uppercase text-slate-500', index === 0 && 'mb-1 block')}>
                  {column.header}
                </span>
                <div className={cn('min-w-0 text-sm font-semibold text-slate-800', index === 0 ? 'text-base font-black text-brand-950' : 'text-right')}>
                  {column.cell(row)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="custom-scrollbar hidden overflow-x-auto md:block">
        <table className="min-w-[720px] divide-y divide-slate-100 lg:min-w-full">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={cn('whitespace-nowrap px-4 py-3 text-left text-xs font-black text-slate-500', column.className)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((row) => (
              <tr key={getRowKey(row)} className="transition hover:bg-slate-50/80">
                {columns.map((column) => (
                  <td key={column.key} className={cn('px-4 py-3 text-sm font-semibold text-slate-700', column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page && pageSize && total != null && onPageChange && onPageSizeChange ? (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          shown={data.length}
          label={paginationLabel}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  )
}

export function DataTableSkeleton({ columns = 4, rows = 5 }: { columns?: number; rows?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Cargando tabla">
      <div className="divide-y divide-slate-100 md:hidden">
        {Array.from({ length: Math.min(rows, 3) }, (_, row) => (
          <div key={row} className="space-y-3 p-4">
            <SkeletonBar className="h-3 w-24" />
            <SkeletonBar className="h-5 w-44" />
            <SkeletonBar className="h-3 w-full" />
            <SkeletonBar className="h-3 w-3/4" />
          </div>
        ))}
      </div>

      <div className="custom-scrollbar hidden overflow-x-auto md:block">
        <table className="min-w-[720px] divide-y divide-slate-100 lg:min-w-full">
          <thead className="bg-slate-50">
            <tr>
              {Array.from({ length: columns }, (_, column) => (
                <th key={column} className="px-4 py-3 text-left">
                  <SkeletonBar className="h-3 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {Array.from({ length: rows }, (_, row) => (
              <tr key={row}>
                {Array.from({ length: columns }, (_, column) => (
                  <td key={column} className="px-4 py-4">
                    <SkeletonBar className={cn('h-4', column === 0 ? 'w-36' : column === columns - 1 ? 'w-20 rounded-full' : 'w-48')} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SkeletonBar({ className }: { className: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/80', className)} />
}

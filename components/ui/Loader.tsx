import { cn } from '@/lib/ui'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-slate-200/80', className)} />
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <Skeleton className="mb-4 h-9 w-48" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}

export function MetricCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Cargando indicadores" aria-busy="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_6px_14px_rgba(15,23,42,.035)]">
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-6 w-24" />
              <Skeleton className="mt-2 h-3 w-36 max-w-full" />
            </div>
            <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function RouteContentSkeleton() {
  return (
    <div className="space-y-5" aria-label="Cargando contenido" aria-busy="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-11 w-36" />
      </div>
      <MetricCardsSkeleton />
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <Skeleton className="h-11 w-full" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
        </div>
      </div>
    </div>
  )
}

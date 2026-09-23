import { cn } from '@/lib/ui'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-slate-200/80', className)} />
}

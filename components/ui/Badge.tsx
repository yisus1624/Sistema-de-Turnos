import { cn } from '@/lib/ui'

type BadgeTone = 'blue' | 'green' | 'amber' | 'red' | 'slate'

const tones: Record<BadgeTone, string> = {
  blue: 'bg-brand-50 text-brand-700 ring-brand-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  red: 'bg-red-50 text-red-700 ring-red-100',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
}

export function Badge({ tone = 'slate', className, children }: { tone?: BadgeTone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-black ring-1', tones[tone], className)}>
      {children}
    </span>
  )
}

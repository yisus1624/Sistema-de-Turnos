import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/ui'

type StatCardProps = {
  title: string
  value: string
  subtitle?: string
  icon: Icon
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'slate'
}

const tones = {
  blue: 'bg-brand-50 text-brand-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  slate: 'bg-slate-100 text-slate-700',
}

export default function StatCard({ title, value, subtitle, icon: Icon, tone = 'blue' }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_18px_rgba(15,23,42,.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-black tracking-[-0.03em] text-brand-950">{value}</p>
          {subtitle ? <p className="mt-1 text-xs font-semibold text-slate-500">{subtitle}</p> : null}
        </div>
        <span className={cn('grid h-11 w-11 place-items-center rounded-xl', tones[tone])}>
          <Icon size={23} weight="duotone" />
        </span>
      </div>
    </div>
  )
}

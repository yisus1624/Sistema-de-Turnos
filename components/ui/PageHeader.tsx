import { cn } from '@/lib/ui'

type PageHeaderProps = {
  title: string
  subtitle?: string
  action?: React.ReactNode
  className?: string
}

export default function PageHeader({ title, subtitle, action, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-xl font-black tracking-[-0.03em] text-brand-950">{title}</h2>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

import type { Icon } from '@phosphor-icons/react'

type EmptyStateProps = {
  icon: Icon
  title: string
  description?: string
  action?: React.ReactNode
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-brand-700">
        <Icon size={30} weight="duotone" />
      </div>
      <h3 className="mt-5 text-lg font-black tracking-[-0.02em] text-brand-950">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}

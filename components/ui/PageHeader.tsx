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
        {/*
          El titulo baja de negra maxima a semi-negrita y se aprieta un poco
          mas. A este tamano, el grosor extremo no anade jerarquia —ya la da
          el tamano— y solo emborrona el contrapunzon de las letras. El
          subtitulo gana interlineado: es la linea que explica la pantalla y
          se lee como frase, no como etiqueta.
        */}
        <h2 className="text-xl font-semibold tracking-[-0.022em] text-brand-950">{title}</h2>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-sm leading-[1.65] text-slate-600">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

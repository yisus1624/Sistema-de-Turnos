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
    <div className="rounded-[1.25rem] border border-slate-200/70 bg-white p-6 shadow-[var(--sombra-md)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/*
            LA CIFRA ES LO UNICO QUE PESA.

            Antes el rotulo iba en negrita y la cifra en negra maxima: dos
            pesos casi iguales compitiendo, y el ojo tenia que buscar el dato
            en vez de encontrarlo. Ahora el rotulo baja a un peso medio y se
            queda en gris, y la cifra se queda sola arriba del todo de la
            jerarquia. Se lee el numero primero, que es para lo que existe
            esta tarjeta.

            `data-cifras` le pone ancho fijo a los digitos (ver globals.css):
            el indicador se refresca solo, y sin eso el numero cambia de ancho
            y la tarjeta da un salto a cada actualizacion.
          */}
          <p className="text-sm font-medium tracking-[0.005em] text-slate-500">{title}</p>
          <p
            data-cifras
            className="mt-1.5 text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] text-brand-950"
          >
            {value}
          </p>
          {subtitle ? <p className="mt-1 text-xs font-medium tracking-[0.01em] text-slate-500">{subtitle}</p> : null}
        </div>
        <span className={cn('grid h-11 w-11 place-items-center rounded-xl', tones[tone])}>
          <Icon size={23} weight="duotone" />
        </span>
      </div>
    </div>
  )
}

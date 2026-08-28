'use client'

/** Campos de formulario compartidos por los modulos de administracion. */

import { cn } from '@/lib/ui'

const base =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-brand-950 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400'

type EtiquetaProps = {
  etiqueta: string
  ayuda?: string
  className?: string
  children: React.ReactNode
}

export function Campo({ etiqueta, ayuda, className, children }: EtiquetaProps) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-600">{etiqueta}</span>
      {children}
      {ayuda ? <span className="mt-1 block text-xs font-medium text-slate-400">{ayuda}</span> : null}
    </label>
  )
}

export function Entrada({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...props} />
}

export function Seleccion({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(base, className)} {...props}>
      {children}
    </select>
  )
}

/** Interruptor accesible para activar o desactivar registros. */
export function Interruptor({
  activo,
  onChange,
  etiqueta,
  disabled,
}: {
  activo: boolean
  onChange: (valor: boolean) => void
  etiqueta: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      disabled={disabled}
      onClick={() => onChange(!activo)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50',
        activo ? 'bg-emerald-500' : 'bg-slate-300',
      )}
    >
      <span
        className={cn(
          'absolute top-1 h-5 w-5 rounded-full bg-white transition-all',
          activo ? 'left-6' : 'left-1',
        )}
      />
    </button>
  )
}

/** Tabla con scroll horizontal y cabecera consistente. */
export function Tabla({ columnas, children }: { columnas: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            {columnas.map((columna) => (
              <th key={columna} className="px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  )
}

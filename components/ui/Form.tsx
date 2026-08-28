import { forwardRef } from 'react'
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/ui'

export function Field({
  label,
  error,
  helper,
  children,
}: {
  label: string
  error?: string
  helper?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-800">{label}</span>
      <span className="mt-2 block">{children}</span>
      {error ? <span className="mt-1.5 block text-sm font-semibold text-red-600">{error}</span> : helper ? <span className="mt-1.5 block text-xs font-semibold text-slate-500">{helper}</span> : null}
    </label>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
        className,
      )}
      {...props}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
        className,
      )}
      {...props}
    />
  )
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
})

/**
 * Groups related fields under a heading. Long forms read as a flat list of controls
 * otherwise, which is what makes them feel long even when the field count is small.
 */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('min-w-0 rounded-2xl border border-slate-200 bg-white p-4', className)}>
      <div className="mb-3.5">
        <h3 className="text-sm font-black text-brand-950">{title}</h3>
        {description ? <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-500">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * Horizontal segmented progress. Always a single row: a stacked list of steps reads as
 * more form to fill in, which is the opposite of what a step indicator is for. Long
 * labels shrink and truncate rather than wrapping to a second line.
 */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex w-full items-center gap-1.5 rounded-full bg-slate-100 p-1.5" aria-label="Progreso del formulario">
      {steps.map((step, index) => {
        const active = index === current
        const done = index < current
        return (
          <li
            key={step}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 transition',
              active ? 'bg-white shadow-sm ring-1 ring-brand-500' : 'bg-transparent',
            )}
          >
            <span
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black',
                active || done ? 'bg-brand-600 text-white' : 'bg-slate-300 text-white',
              )}
            >
              {index + 1}
            </span>
            <span className={cn('truncate text-xs font-black', active ? 'text-brand-700' : 'text-slate-500')}>{step}</span>
          </li>
        )
      })}
    </ol>
  )
}

import { cn } from '@/lib/ui'

/*
 * `padded` and `surface` exist because cn() is a plain join: it does not resolve Tailwind
 * conflicts, so passing `p-4` or `bg-transparent` through className leaves both utilities
 * in the list and the winner is whichever Tailwind emits later — `p-5` beats `p-4` but
 * loses to `p-8`, `bg-white` beats `bg-transparent`. Opting the defaults out is the only
 * reliable way to override them.
 */
type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  padded?: boolean
  surface?: boolean
}

export function Card({ className, padded = true, surface = true, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl',
        surface && 'border border-slate-200 bg-white shadow-[0_8px_18px_rgba(15,23,42,.04)]',
        padded && 'p-5',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4', className)} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn('text-base font-black tracking-[-0.02em] text-brand-950', className)} {...props}>
      {children}
    </h2>
  )
}

export function CardContent({ className, padded = true, children, ...props }: CardProps) {
  return (
    <div className={cn(padded && 'p-5', className)} {...props}>
      {children}
    </div>
  )
}

'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import { cn } from '@/lib/ui'

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  headerIcon?: React.ReactNode
  headerAction?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
}

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-5xl',
}

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function Modal({ open, onClose, title, description, headerIcon, headerAction, children, footer, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.getAttribute('aria-hidden') !== 'true')

      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === dialog || active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const focusFrame = requestAnimationFrame(() => dialogRef.current?.focus())
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previous
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-slate-950/45"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        aria-label={title ? undefined : 'Ventana de dialogo'}
        tabIndex={-1}
        className={cn('relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_24px_80px_rgba(15,23,42,.24)] md:rounded-2xl', sizes[size])}
      >
        {title ? (
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              {headerIcon}
              <div className="min-w-0">
                <h2 id={titleId} className="text-lg font-black tracking-[-0.02em] text-brand-950">{title}</h2>
                {description ? <p id={descriptionId} className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerAction}
              <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 active:scale-[.96]" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>
          </header>
        ) : null}
        {/* The body owns the only mobile scroll. Variable-height headers and optional
            footers stay visible without relying on a hard-coded header height. */}
        <div className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-5">{children}</div>
        {footer ? (
          <footer className="flex shrink-0 items-center justify-end border-t border-slate-100 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 md:pb-4">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}

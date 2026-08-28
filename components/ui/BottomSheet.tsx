'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'

type BottomSheetProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button aria-label="Cerrar sheet" className="absolute inset-0 cursor-default bg-slate-950/45" onClick={onClose} />
      <section className="relative w-full overflow-hidden rounded-t-2xl bg-white shadow-[0_-20px_60px_rgba(15,23,42,.24)] sm:mb-5 sm:max-w-md sm:rounded-2xl">
        <div className="flex justify-center pt-3">
          <div className="h-1.5 w-12 rounded-full bg-slate-300" />
        </div>
        {title ? (
          <header className="flex items-center justify-between gap-4 px-5 py-4">
            <h2 className="text-lg font-black tracking-[-0.02em] text-brand-950">{title}</h2>
            <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 active:scale-[.96]" aria-label="Cerrar">
              <X size={20} />
            </button>
          </header>
        ) : null}
        <div className="custom-scrollbar max-h-[78dvh] overflow-y-auto px-5 pb-5">{children}</div>
      </section>
    </div>,
    document.body,
  )
}

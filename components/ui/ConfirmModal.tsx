'use client'

import { WarningCircle } from '@phosphor-icons/react'
import Modal from './Modal'
import Button from './Button'

type ConfirmModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  loading?: boolean
  title: string
  message?: string
  description?: string
  children?: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
}

export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  loading = false,
  title,
  message,
  description,
  children,
  confirmLabel = 'Confirmar',
  danger = false,
  size = 'sm',
}: ConfirmModalProps) {
  // Title, icon and description live in Modal's sticky header so they never scroll out of
  // view; the buttons live in the sticky footer. Only the body (children) scrolls.
  return (
    <Modal
      open={open}
      onClose={onClose}
      size={size}
      title={title}
      description={description ?? message}
      headerIcon={(
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${danger ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
          <WarningCircle size={22} weight="duotone" />
        </span>
      )}
      footer={(
        <div className="grid w-full grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      )}
    >
      {children}
    </Modal>
  )
}

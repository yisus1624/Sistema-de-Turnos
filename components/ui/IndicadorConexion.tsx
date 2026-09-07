'use client'

/**
 * Semaforo de la conexion de eventos en vivo.
 *
 * Estas pantallas se dejan abiertas toda la jornada y se actualizan solas: si
 * la conexion se cae, lo que se ve deja de ser cierto sin que nada lo delate.
 * Este indicador es el que avisa que hay que desconfiar de lo que hay en
 * pantalla, antes de que alguien llame a un paciente que ya se fue.
 */

import { cn } from '@/lib/ui'
import type { EstadoConexionEnVivo } from '@/lib/hooks'

const APARIENCIA: Record<EstadoConexionEnVivo, { texto: string; caja: string; punto: string }> = {
  'en-vivo': { texto: 'EN VIVO', caja: 'bg-emerald-100 text-emerald-700', punto: 'bg-emerald-500' },
  reconectando: { texto: 'RECONECTANDO', caja: 'bg-red-100 text-red-700', punto: 'bg-red-500' },
}

export function IndicadorConexion({
  estado,
  className,
}: {
  estado: EstadoConexionEnVivo
  className?: string
}) {
  const { texto, caja, punto } = APARIENCIA[estado]

  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black', caja, className)}
    >
      <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', punto)} />
      {texto}
    </span>
  )
}

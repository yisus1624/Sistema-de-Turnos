import { cn } from '@/lib/ui'

/**
 * "NUEVO", pegado a la esquina de un turno recien llamado.
 *
 * Dura mas que el resalte (ver `MS_NUEVO`): quien levanta la vista tarde ve de
 * un golpe que turnos cambiaron en el ultimo minuto, aunque ya se hayan
 * llamado varios seguidos. Ambar sobre texto casi negro (mas de 10:1), sin
 * animacion: el destello ya lo pone la fila.
 */
export function EtiquetaNuevo({ tamano, className }: { tamano: number; className?: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute z-10 rounded-[0.35em] bg-amber-300 px-[0.45em] py-[0.12em] font-black leading-none tracking-[0.06em] text-slate-950 shadow-[0_2px_6px_rgba(10,38,52,.25)]',
        className,
      )}
      style={{ fontSize: Math.max(12, Math.round(tamano)) }}
    >
      NUEVO
    </span>
  )
}

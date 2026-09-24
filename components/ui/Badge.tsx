import { cn } from '@/lib/ui'

type BadgeTone = 'blue' | 'acento' | 'green' | 'amber' | 'red' | 'slate'

const tones: Record<BadgeTone, string> = {
  blue: 'bg-brand-50 text-brand-700 ring-brand-100',
  /*
   * El azul de lo que esta por pasar.
   *
   * `blue` es el teal de la marca, y junto al verde de "atendida" y al ambar
   * de "ya llego" se leia como un cuarto verde apagado: los tres estados de
   * una cita acababan siendo tonos del mismo sitio de la rueda. Este azul si
   * se separa de los otros dos, que es lo unico que se le pide a una etiqueta
   * de estado que se mira de reojo.
   */
  acento: 'bg-acento-50 text-acento-700 ring-acento-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  red: 'bg-red-50 text-red-700 ring-red-100',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
}

export function Badge({ tone = 'slate', className, children }: { tone?: BadgeTone; className?: string; children: React.ReactNode }) {
  return (
    /*
     * Peso 600 y las letras un poco MAS separadas, no menos.
     *
     * Es la regla al reves que en los titulos, y es a proposito: a 12px las
     * letras se tocan y la palabra se vuelve una mancha, sobre todo en negra
     * maxima y en mayusculas. Abrir el espaciado unas milesimas es lo que
     * hace legible una etiqueta de estado —"EN ATENCION", "AUSENTE"— que se
     * mira de reojo mientras se atiende a alguien.
     */
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold tracking-[0.015em] ring-1',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

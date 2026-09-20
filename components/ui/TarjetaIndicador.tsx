/**
 * Tarjeta de cifra para las cabeceras de los tableros.
 *
 * La cifra es lo mas grande porque es lo unico que se mira desde lejos; la
 * etiqueta va arriba en el color del estado y la aclaracion debajo, en gris,
 * para quien se detiene a leerla. La barra de color es lateral y fina: senala
 * la tarjeta sin convertirla en un bloque de color.
 *
 * Vive aqui y no dentro de una pantalla porque la usan varios tableros
 * (turnos en curso, profesionales) y son la misma pieza: si se copia, el dia
 * que cambie el tamano de la cifra cambiara solo en una de ellas.
 */

import type { Icon } from '@phosphor-icons/react'
import { Card } from './Card'

export type TonoIndicador = {
  /** Barra lateral, en color pleno. */
  barra: string
  /** Disco del icono. Normalmente el color pleno con el glifo en blanco. */
  disco: string
  /** Color de la etiqueta. */
  texto: string
}

/** Los tonos que se repiten en los tableros, para no reescribirlos en cada uno. */
export const TONOS_INDICADOR = {
  acento: { barra: 'bg-acento-500', disco: 'bg-acento-500 text-white', texto: 'text-acento-700' },
  verde: { barra: 'bg-emerald-500', disco: 'bg-emerald-500 text-white', texto: 'text-emerald-700' },
  ambar: { barra: 'bg-amber-400', disco: 'bg-amber-400 text-white', texto: 'text-amber-700' },
  rojo: { barra: 'bg-rose-500', disco: 'bg-rose-500 text-white', texto: 'text-rose-700' },
  pizarra: { barra: 'bg-slate-400', disco: 'bg-slate-400 text-white', texto: 'text-slate-600' },
} satisfies Record<string, TonoIndicador>

export function TarjetaIndicador({
  icono: Icono,
  etiqueta,
  valor,
  detalle,
  tono,
}: {
  icono: Icon
  etiqueta: string
  valor: number
  detalle: string
  tono: TonoIndicador
}) {
  return (
    <Card padded={false} className="relative overflow-hidden rounded-[1.375rem]">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${tono.barra}`} aria-hidden="true" />
      <div className="flex items-start gap-3.5 py-4 pl-6 pr-5">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tono.disco}`}>
          <Icono size={22} weight="fill" />
        </span>
        <div className="min-w-0">
          <p className={`text-[13px] font-semibold leading-tight tracking-[-0.008em] ${tono.texto}`}>
            {etiqueta}
          </p>
          <p className="mt-1 text-[32px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-brand-950">
            {valor}
          </p>
          <p className="mt-1.5 truncate text-xs font-medium leading-tight text-slate-500">{detalle}</p>
        </div>
      </div>
    </Card>
  )
}

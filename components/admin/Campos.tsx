'use client'

/** Campos de formulario compartidos por los modulos de administracion. */

import { useState } from 'react'
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
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-600">{etiqueta}</span>
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
  /** Si devuelve una promesa, el interruptor queda bloqueado hasta que termine. */
  onChange: (valor: boolean) => void | Promise<void>
  etiqueta: string
  disabled?: boolean
}) {
  // Bloqueado mientras se guarda: sin esto, un doble clic mandaba dos
  // peticiones (y dos avisos) antes de que llegara la primera respuesta.
  const [guardando, setGuardando] = useState(false)

  async function alternar() {
    if (guardando) return
    setGuardando(true)
    try {
      await onChange(!activo)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      aria-busy={guardando}
      // Mientras guarda se bloquea con `aria-disabled` y no con `disabled`: un
      // boton deshabilitado suelta el foco, y quien usa teclado volvia al
      // principio de la pagina tras cada cambio. El doble clic lo frena
      // `alternar`.
      aria-disabled={guardando || undefined}
      disabled={disabled}
      onClick={() => void alternar()}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 aria-disabled:opacity-50',
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

/**
 * Tabla en carga: la misma cabecera con filas grises que laten.
 *
 * Se dibuja con las columnas reales para que la fila no salte de ancho cuando
 * llegan los datos.
 */
export function TablaSkeleton({ columnas, filas = 6 }: { columnas: string[]; filas?: number }) {
  // Anchos variados: una tabla de barras identicas no se lee como una tabla.
  const anchos = ['w-24', 'w-36', 'w-28', 'w-20', 'w-32', 'w-16']

  return (
    <div aria-busy="true" aria-label="Cargando informacion">
      <Tabla columnas={columnas}>
        {Array.from({ length: filas }).map((_, fila) => (
          <tr key={fila}>
            {columnas.map((_columna, columna) => (
              <td key={columna} className="px-4 py-3.5">
                <span
                  className={cn(
                    'block h-4 animate-pulse rounded-md bg-slate-200/80',
                    anchos[(fila + columna) % anchos.length],
                  )}
                />
              </td>
            ))}
          </tr>
        ))}
      </Tabla>
    </div>
  )
}

/** Tabla con scroll horizontal y cabecera consistente. */
/**
 * Cuando empezar a mostrar cada fila como una tarjeta, segun cuantas columnas
 * tenga la tabla (ver `.tabla-adaptable` en globals.css). Con mas columnas,
 * antes: una tabla de ocho no cabe en el ancho donde una de cuatro si.
 */
function anchoParaApilar(columnas: number): 'angosta' | 'media' | 'ancha' {
  if (columnas <= 4) return 'angosta'
  if (columnas <= 6) return 'media'
  return 'ancha'
}

/**
 * La tabla de administracion. Se ve COMPLETA en cualquier pantalla, sin
 * barra de desplazamiento lateral: en una ancha, las celdas parten el texto y
 * se aprietan; cuando ya no caben, cada fila pasa a ser una tarjeta con la
 * etiqueta de cada dato a la izquierda. Las etiquetas salen de `columnas`
 * (variables CSS), asi ninguna tabla tiene que repetirlas en sus celdas.
 */
export function Tabla({ columnas, children }: { columnas: string[]; children: React.ReactNode }) {
  const etiquetas = Object.fromEntries(
    columnas.map((columna, i) => [`--etiqueta-${i + 1}`, JSON.stringify(columna)]),
  ) as React.CSSProperties
  return (
    <div className="tabla-adaptable" data-apilar={anchoParaApilar(columnas.length)} style={etiquetas}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            {columnas.map((columna) => (
              <th key={columna} className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
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

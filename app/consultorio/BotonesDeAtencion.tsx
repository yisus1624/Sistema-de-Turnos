'use client'

/**
 * Las cuatro acciones del doctor, grandes y en una fila: se usan de pie o
 * entre dos consultas, con prisa, y cada una tiene su color para encontrarla
 * sin leer. La principal ("Llamar siguiente paciente") es la unica rellena.
 *
 * Responden al presionar (se encogen al instante) y, mientras la peticion va,
 * el icono se vuelve una rueda: el doctor ve que el clic llego.
 */
import { ArrowClockwise, CaretRight, CheckCircle, CircleNotch, Megaphone, UserMinus } from '@phosphor-icons/react/dist/ssr'
import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/ui'

export type AccionDoctor = 'llamar' | 'repetir' | 'atendido' | 'ausente' | 'retroceder'

const TONOS = {
  principal: {
    caja: 'bg-gradient-to-br from-acento-500 to-acento-700 text-white shadow-lg shadow-acento-600/25 hover:brightness-[1.06]',
    icono: 'bg-white/20 text-white',
    flecha: 'text-white/80',
  },
  verde: {
    caja: 'border border-emerald-200/80 bg-emerald-50 text-emerald-900 hover:bg-emerald-100/70',
    icono: 'bg-emerald-500 text-white',
    flecha: 'text-emerald-700/60',
  },
  azul: {
    caja: 'border border-acento-100 bg-acento-50/70 text-acento-900 hover:bg-acento-100/70',
    icono: 'bg-white text-acento-600 ring-1 ring-acento-100',
    flecha: 'text-acento-700/50',
  },
  rojo: {
    caja: 'border border-red-200/80 bg-red-50 text-red-800 hover:bg-red-100/70',
    icono: 'bg-white text-red-600 ring-1 ring-red-100',
    flecha: 'text-red-700/50',
  },
} as const

function BotonDeAccion({
  tono,
  icono: Icono,
  texto,
  detalle,
  cargando,
  deshabilitado,
  alPulsar,
  className,
}: {
  tono: keyof typeof TONOS
  icono: Icon
  texto: string
  detalle?: string
  cargando: boolean
  deshabilitado: boolean
  alPulsar: () => void
  className?: string
}) {
  const estilo = TONOS[tono]
  return (
    <button
      type="button"
      onClick={alPulsar}
      disabled={deshabilitado || cargando}
      aria-busy={cargando || undefined}
      className={cn(
        'group flex h-[4.5rem] w-full select-none items-center gap-3.5 rounded-2xl px-4 text-left outline-none',
        'transition-[background-color,filter,opacity] duration-[var(--suave)]',
        'active:scale-[.98] active:transition-transform active:duration-[var(--toque)]',
        'focus-visible:ring-4 focus-visible:ring-acento-200',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:scale-100',
        estilo.caja,
        className,
      )}
    >
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full', estilo.icono)}>
        {cargando ? <CircleNotch size={22} weight="bold" className="animate-spin" /> : <Icono size={22} weight="bold" />}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{texto}</span>
        {detalle ? <span className="mt-0.5 block truncate text-xs font-medium opacity-80">{detalle}</span> : null}
      </span>
      <CaretRight
        size={16}
        weight="bold"
        className={cn('shrink-0 transition-transform duration-[var(--suave)] group-hover:translate-x-0.5', estilo.flecha)}
      />
    </button>
  )
}

export function BotonesDeAtencion({
  accion,
  hayPaciente,
  puedeLlamar,
  enEspera,
  alLlamar,
  alAtender,
  alRepetir,
  alAusente,
}: {
  accion: AccionDoctor | null
  hayPaciente: boolean
  puedeLlamar: boolean
  enEspera: number
  alLlamar: () => void
  alAtender: () => void
  alRepetir: () => void
  alAusente: () => void
}) {
  // Mientras una accion va, las demas esperan: dos acciones cruzadas sobre el
  // mismo paciente son justo lo que el servidor tendria que rechazar.
  const ocupado = accion !== null
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.35fr_1fr_1fr_1fr]">
      <BotonDeAccion
        tono="principal"
        icono={Megaphone}
        texto="Llamar siguiente paciente"
        detalle={enEspera > 0 ? `${enEspera} en espera` : 'Nadie en espera'}
        cargando={accion === 'llamar'}
        deshabilitado={!puedeLlamar || ocupado}
        alPulsar={alLlamar}
        className="sm:col-span-2 lg:col-span-1"
      />
      <BotonDeAccion
        tono="verde"
        icono={CheckCircle}
        texto="Atendido"
        cargando={accion === 'atendido'}
        deshabilitado={!hayPaciente || ocupado}
        alPulsar={alAtender}
      />
      <BotonDeAccion
        tono="azul"
        icono={ArrowClockwise}
        texto="Repetir llamado"
        cargando={accion === 'repetir'}
        deshabilitado={!hayPaciente || ocupado}
        alPulsar={alRepetir}
      />
      <BotonDeAccion
        tono="rojo"
        icono={UserMinus}
        texto="No se presentó"
        cargando={accion === 'ausente'}
        deshabilitado={!hayPaciente || ocupado}
        alPulsar={alAusente}
        className="sm:col-span-2 lg:col-span-1"
      />
    </div>
  )
}

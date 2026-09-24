'use client'

/**
 * El paciente que el doctor tiene al frente: quien es (nombre completo y
 * documento: aqui SI se muestran, es su medico tratante), que turno lleva y
 * desde cuando se le llamo. Si no hay nadie, cuantos esperan.
 *
 * Arriba a la derecha va "Retroceder": el perdon para el clic equivocado (ver
 * `lib/turnos/reglas-retroceso.ts`). Dice a quien recupera antes de pulsarlo.
 */
import {
  ArrowCounterClockwise,
  Clock,
  IdentificationCard,
  Info,
  MapPin,
  Stethoscope,
  UserCircle,
} from '@phosphor-icons/react/dist/ssr'
import type { Icon } from '@phosphor-icons/react'
import { horaCorta } from '@/lib/api/cliente'
import { documentoLegible, iniciales } from '@/lib/consultorio/presentacion'
import { cn } from '@/lib/ui'
import type { Turno } from '@/lib/turnos/types'

function Dato({ icono: Icono, etiqueta, valor, detalle }: { icono: Icon; etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-acento-50 text-acento-600">
        <Icono size={21} weight="duotone" />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-xs font-medium text-slate-500">{etiqueta}</p>
        <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-brand-950">{valor}</p>
        {detalle ? <p className="text-xs font-medium text-slate-500">{detalle}</p> : null}
      </div>
    </div>
  )
}

export function TarjetaPaciente({
  turno,
  documento,
  especialidad,
  consultorio,
  enEspera,
  etiquetaRetroceso,
  retrocediendo,
  ocupado,
  alRetroceder,
}: {
  turno: Turno | null
  documento: string | null
  especialidad: string | null
  consultorio: string | null
  enEspera: number
  /** "Volver a C-010", o null si no hay nada que retroceder. */
  etiquetaRetroceso: string | null
  retrocediendo: boolean
  /** Hay otra accion en curso: mientras tanto no se retrocede. */
  ocupado: boolean
  alRetroceder: () => void
}) {
  const nombre = turno?.nombrePaciente?.trim() || null
  const documentoVisible = documentoLegible(documento)

  return (
    <section
      aria-label="Paciente en atencion"
      className="overflow-hidden rounded-[1.75rem] border border-white bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-12px_rgba(20,108,140,0.18)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-7 sm:pt-6">
        {turno ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-acento-600 px-3.5 py-1.5 text-xs font-semibold tracking-[0.01em] text-white shadow-sm shadow-acento-600/25">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            En consulta
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3.5 py-1.5 text-xs font-semibold text-slate-600">
            Consultorio libre
          </span>
        )}

        {/*
          No compite con las acciones de abajo: es la salida de emergencia de un
          clic equivocado, asi que va discreta, pero siempre en el mismo sitio y
          diciendo a quien recupera.
        */}
        <button
          type="button"
          onClick={alRetroceder}
          disabled={!etiquetaRetroceso || ocupado}
          title="Deshace tu ultima accion: el paciente que llamaste vuelve a la fila y el anterior vuelve a atencion"
          className={cn(
            'inline-flex h-10 select-none items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700',
            'transition-[background-color,color,opacity] duration-[var(--suave)] hover:bg-slate-50 hover:text-acento-700',
            'active:scale-[.97] active:transition-transform active:duration-[var(--toque)]',
            'disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100',
          )}
        >
          <ArrowCounterClockwise size={17} weight="bold" className={cn(retrocediendo && 'animate-spin [animation-direction:reverse]')} />
          {etiquetaRetroceso ?? 'Retroceder'}
        </button>
      </div>

      {turno ? (
        // La llave es el turno: al cambiar de paciente la tarjeta entra de
        // nuevo, un leve deslizamiento que dice "esto cambio" sin distraer.
        <div key={turno.id} className="consultorio-aparece grid gap-6 px-5 pb-6 pt-5 sm:px-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-0">
          <div className="flex min-w-0 items-center gap-5 lg:pr-7">
            <span
              aria-hidden="true"
              className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-gradient-to-br from-acento-400 to-acento-600 text-2xl font-semibold tracking-[-0.02em] text-white shadow-lg shadow-acento-600/25 sm:h-24 sm:w-24 sm:text-3xl"
            >
              {nombre ? iniciales(nombre) : <UserCircle size={44} weight="fill" />}
            </span>
            <div className="min-w-0">
              <p className="text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.025em] text-brand-950 sm:text-[2rem]">
                {nombre ?? 'Paciente de ventanilla'}
              </p>
              {documentoVisible ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium tabular-nums text-slate-500">
                  <IdentificationCard size={16} weight="duotone" />
                  Documento {documentoVisible}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-acento-50 px-3.5 py-1.5 text-sm font-semibold tabular-nums text-acento-700 ring-1 ring-acento-100">
                  Turno {turno.codigo}
                </span>
                {turno.horaCita ? (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3.5 py-1.5 text-sm font-medium tabular-nums text-slate-600">
                    Cita {horaCorta(turno.horaCita)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid content-center gap-4 border-slate-100 lg:border-l lg:px-7">
            <Dato icono={Stethoscope} etiqueta="Especialidad" valor={especialidad ?? '—'} />
            <Dato
              icono={Clock}
              etiqueta="Llamado"
              valor={horaCorta(turno.horaLlamado)}
              detalle={turno.vecesLlamado > 1 ? `Llamado ${turno.vecesLlamado} veces` : 'Llamado 1 vez'}
            />
            <Dato icono={MapPin} etiqueta="Consultorio" valor={consultorio ?? '—'} />
          </div>

          <div className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600 lg:ml-2 lg:self-center">
            <Info size={20} weight="duotone" className="mt-0.5 shrink-0 text-acento-600" />
            <p>
              Cuando termines, pulsa <strong className="font-semibold text-brand-950">Atendido</strong>. Si llamas al
              siguiente, este paciente se cierra solo; si fue un error, <strong className="font-semibold text-brand-950">Retroceder</strong> lo
              devuelve.
            </p>
          </div>
        </div>
      ) : (
        <div key="libre" className="consultorio-aparece flex flex-col items-center px-6 pb-8 pt-4 text-center">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-slate-100 text-slate-400">
            <Stethoscope size={38} weight="duotone" />
          </span>
          <p className="mt-4 text-xl font-semibold tracking-[-0.02em] text-brand-950">Sin paciente en atención</p>
          <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
            {enEspera > 0
              ? `Tienes ${enEspera} ${enEspera === 1 ? 'paciente esperando' : 'pacientes esperando'}. Pulsa "Llamar siguiente paciente" cuando estes listo.`
              : 'No hay pacientes esperando. Aparecen aqui en cuanto registran su llegada en admisiones.'}
          </p>
        </div>
      )}
    </section>
  )
}

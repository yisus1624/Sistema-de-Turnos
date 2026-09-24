'use client'

/**
 * Antes de retroceder, lo que va a pasar, con nombre y turno: quien vuelve a
 * la sala de espera y quien vuelve a atencion (y a la pantalla de la sala).
 *
 * Se confirma porque cambia lo que ve la sala entera, no porque sea peligroso:
 * todo lo que hace se puede rehacer con "Llamar siguiente paciente".
 */
import { ArrowBendUpLeft, Hourglass } from '@phosphor-icons/react/dist/ssr'
import type { Icon } from '@phosphor-icons/react'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { queSeDeshace } from '@/lib/consultorio/presentacion'
import type { PlanDeRetroceso } from '@/lib/turnos/reglas-retroceso'
import type { Turno } from '@/lib/turnos/types'

function Paso({ icono: Icono, tono, turno, texto }: { icono: Icon; tono: string; turno: Turno; texto: string }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${tono}`}>
        <Icono size={20} weight="bold" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-brand-950">
          <span className="tabular-nums">{turno.codigo}</span>
          {turno.nombrePaciente ? ` · ${turno.nombrePaciente}` : ''}
        </p>
        <p className="mt-0.5 text-sm leading-5 text-slate-600">{texto}</p>
      </div>
    </li>
  )
}

export function ConfirmarRetroceso({
  plan,
  abierto,
  cargando,
  alCerrar,
  alConfirmar,
}: {
  plan: PlanDeRetroceso | null
  abierto: boolean
  cargando: boolean
  alCerrar: () => void
  alConfirmar: () => void
}) {
  return (
    <ConfirmModal
      open={abierto && plan !== null}
      onClose={alCerrar}
      onConfirm={alConfirmar}
      loading={cargando}
      title="¿Retroceder al turno anterior?"
      description="Deshace tu ultima accion. La pantalla de la sala se actualiza al instante, sin volver a sonar."
      confirmLabel="Retroceder"
    >
      {plan ? (
        <ul className="space-y-2.5">
          {plan.restaurar ? (
            <Paso
              icono={ArrowBendUpLeft}
              tono="bg-acento-600 text-white"
              turno={plan.restaurar}
              texto={queSeDeshace(plan.restaurar, plan.devolver !== null)}
            />
          ) : null}
          {plan.devolver ? (
            <Paso
              icono={Hourglass}
              tono="bg-white text-slate-600 ring-1 ring-slate-200"
              turno={plan.devolver}
              texto="Vuelve a la sala de espera, en el mismo lugar de tu fila. Sale de la pantalla de la sala."
            />
          ) : null}
        </ul>
      ) : null}
    </ConfirmModal>
  )
}

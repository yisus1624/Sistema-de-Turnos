'use client'

/**
 * Los pacientes de HOY del doctor, en el orden de sus citas.
 *
 * Solo los que ya registraron su llegada en admisiones: con los que aun no
 * llegan el doctor no puede hacer nada, y se cuentan arriba en vez de llenar
 * la lista. El paciente en atencion se marca; los cerrados quedan atenuados.
 * Siempre es el dia de hoy: la pantalla pasa sola al dia siguiente.
 */
import { CalendarCheck, Clock } from '@phosphor-icons/react/dist/ssr'
import { Badge } from '@/components/ui/Badge'
import { horaCorta } from '@/lib/api/cliente'
import { documentoLegible, iniciales, type ResumenDelDia } from '@/lib/consultorio/presentacion'
import { cn } from '@/lib/ui'
import type { EstadoAgendaItem, ItemAgendaProfesional } from '@/lib/turnos/types'

type Tono = 'blue' | 'green' | 'amber' | 'red' | 'slate'

const ETIQUETA: Record<EstadoAgendaItem, { texto: string; tono: Tono }> = {
  PROGRAMADA: { texto: 'Aun no ha llegado', tono: 'slate' },
  EN_ESPERA: { texto: 'En espera', tono: 'blue' },
  LLAMADO: { texto: 'En atención', tono: 'amber' },
  EN_ATENCION: { texto: 'En atención', tono: 'amber' },
  ATENDIDA: { texto: 'Atendido', tono: 'green' },
  AUSENTE: { texto: 'No se presentó', tono: 'red' },
}

function Contador({ valor, texto, tono }: { valor: number; texto: string; tono: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium', tono)}>
      <span className="text-sm font-semibold tabular-nums">{valor}</span>
      {texto}
    </span>
  )
}

export function AgendaDeHoy({
  agenda,
  resumen,
  turnoActualId,
}: {
  agenda: ItemAgendaProfesional[]
  resumen: ResumenDelDia
  turnoActualId: string | null
}) {
  const confirmados = agenda.filter((item) => item.estado !== 'PROGRAMADA')

  return (
    <section
      aria-label="Pacientes de hoy"
      className="rounded-[1.75rem] border border-white bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(20,108,140,0.14)] sm:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-acento-50 text-acento-600">
            <CalendarCheck size={22} weight="duotone" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-brand-950">Pacientes de hoy</h2>
            <p className="text-xs font-medium text-slate-500">Los que ya registraron su llegada, en el orden de su cita</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Contador valor={resumen.enEspera} texto="en espera" tono="bg-acento-50 text-acento-800" />
          <Contador valor={resumen.atendidos} texto="atendidos" tono="bg-emerald-50 text-emerald-800" />
          {resumen.sinLlegar > 0 ? (
            <Contador valor={resumen.sinLlegar} texto="sin llegar" tono="bg-slate-100 text-slate-600" />
          ) : null}
          <Contador valor={resumen.total} texto="en el día" tono="bg-slate-100 text-slate-600" />
        </div>
      </div>

      {confirmados.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-slate-50 px-5 py-6 text-center text-sm leading-6 text-slate-500">
          {agenda.length > 0
            ? `Tienes ${resumen.sinLlegar} ${resumen.sinLlegar === 1 ? 'cita' : 'citas'} hoy. Los pacientes aparecen aqui en cuanto registran su llegada en admisiones.`
            : 'No tienes citas programadas para hoy.'}
        </p>
      ) : (
        <ol className="mt-5 space-y-2">
          {confirmados.map((item) => {
            // Un turno que se cerro solo (al pasar al siguiente sin cerrar al
            // anterior) no se puede ver igual que uno atendido de verdad.
            const etiqueta =
              item.estado === 'ATENDIDA' && item.cierreAutomatico
                ? { texto: 'Cerrado al pasar al siguiente', tono: 'slate' as const }
                : ETIQUETA[item.estado]
            const actual = item.turnoId !== null && item.turnoId === turnoActualId
            const cerrado = item.estado === 'ATENDIDA' || item.estado === 'AUSENTE'
            return (
              <li
                key={item.citaId}
                aria-current={actual ? 'true' : undefined}
                className={cn(
                  'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 transition-colors duration-[var(--suave)] sm:grid-cols-[6.5rem_4.5rem_minmax(0,1fr)_auto]',
                  actual ? 'border-acento-200 bg-acento-50/60 ring-1 ring-acento-100' : 'border-slate-100 bg-white',
                  cerrado && 'opacity-70',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium tabular-nums text-slate-500">
                  <Clock size={16} weight="duotone" className="text-acento-500" />
                  {horaCorta(item.horaCita)}
                </span>
                <span className="text-sm font-semibold tabular-nums text-brand-950 sm:order-none">{item.codigo ?? '—'}</span>
                <span className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1">
                  <span
                    aria-hidden="true"
                    className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 sm:grid"
                  >
                    {iniciales(item.nombrePaciente)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-800">{item.nombrePaciente}</span>
                    {documentoLegible(item.documentoPaciente) ? (
                      <span className="block truncate text-xs tabular-nums text-slate-500">
                        {documentoLegible(item.documentoPaciente)}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="col-span-2 sm:col-span-1 sm:justify-self-end">
                  <Badge tone={etiqueta.tono}>{etiqueta.texto}</Badge>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

'use client'

/**
 * Los pacientes de HOY del doctor, en el orden de sus citas.
 *
 * Solo los que ya registraron su llegada en admisiones: con los que aun no
 * llegan el doctor no puede hacer nada, y se cuentan arriba en vez de llenar
 * la lista. El paciente en atencion se marca; los cerrados quedan atenuados.
 * Siempre es el dia de hoy: la pantalla pasa sola al dia siguiente.
 *
 * FILTROS (pedido del hospital): "en espera" y "atendidos" se tocan y dejan en
 * la lista solo esos; tocar otra vez el mismo vuelve a todos. El total del dia
 * es solo un numero, no filtra.
 */
import { useState } from 'react'
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

type Filtro = 'todos' | 'espera' | 'atendidos'

/** Que deja ver cada filtro. */
const DEJA_VER: Record<Filtro, (item: ItemAgendaProfesional) => boolean> = {
  todos: () => true,
  espera: (item) => item.estado === 'EN_ESPERA',
  atendidos: (item) => item.estado === 'ATENDIDA',
}

/** Lo que se dice cuando el filtro no deja a nadie. */
const SIN_NADIE: Record<Exclude<Filtro, 'todos'>, string> = {
  espera: 'No hay pacientes esperando en este momento.',
  atendidos: 'Todavia no has atendido a ningun paciente hoy.',
}

function Contador({ valor, texto, tono }: { valor: number; texto: string; tono: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium', tono)}>
      <span className="text-sm font-semibold tabular-nums">{valor}</span>
      {texto}
    </span>
  )
}

/** Un contador que filtra: se ve apretado mientras su filtro esta puesto. */
function Filtrar({
  valor,
  texto,
  tono,
  activo,
  alPulsar,
}: {
  valor: number
  texto: string
  tono: { normal: string; activo: string }
  activo: boolean
  alPulsar: () => void
}) {
  return (
    <button
      type="button"
      onClick={alPulsar}
      aria-pressed={activo}
      title={activo ? 'Ver todos los pacientes' : `Ver solo los ${texto}`}
      className={cn(
        'inline-flex items-baseline gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition active:scale-[.97]',
        activo ? tono.activo : tono.normal,
      )}
    >
      <span className="text-sm font-semibold tabular-nums">{valor}</span>
      {texto}
    </button>
  )
}

export function AgendaDeHoy({
  agenda,
  resumen,
  turnoActualId,
  sinCodigo = false,
}: {
  /** Con la cartelera de nombres el codigo no se muestra (el paciente no lo conoce). */
  sinCodigo?: boolean
  agenda: ItemAgendaProfesional[]
  resumen: ResumenDelDia
  turnoActualId: string | null
}) {
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const alternar = (elegido: Exclude<Filtro, 'todos'>) => setFiltro((actual) => (actual === elegido ? 'todos' : elegido))

  const confirmados = agenda.filter((item) => item.estado !== 'PROGRAMADA')
  const visibles = confirmados.filter(DEJA_VER[filtro])

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
            <p className="text-xs font-medium text-slate-500">
              {filtro === 'espera'
                ? 'Solo los que estan esperando, en el orden de su cita'
                : filtro === 'atendidos'
                  ? 'Solo los que ya atendiste hoy'
                  : 'Los que ya registraron su llegada, en el orden de su cita'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Filtrar
            valor={resumen.enEspera}
            texto="en espera"
            activo={filtro === 'espera'}
            alPulsar={() => alternar('espera')}
            tono={{
              normal: 'bg-acento-50 text-acento-800 ring-transparent hover:ring-acento-200',
              activo: 'bg-acento-600 text-white ring-acento-600',
            }}
          />
          <Filtrar
            valor={resumen.atendidos}
            texto="atendidos"
            activo={filtro === 'atendidos'}
            alPulsar={() => alternar('atendidos')}
            tono={{
              normal: 'bg-emerald-50 text-emerald-800 ring-transparent hover:ring-emerald-200',
              activo: 'bg-emerald-600 text-white ring-emerald-600',
            }}
          />
          {/* El total no filtra: es cuantos pacientes tiene el medico hoy. */}
          <Contador valor={resumen.total} texto="pacientes hoy" tono="bg-slate-100 text-slate-600" />
        </div>
      </div>

      {confirmados.length > 0 && visibles.length === 0 && filtro !== 'todos' ? (
        <p className="mt-6 rounded-2xl bg-slate-50 px-5 py-6 text-center text-sm leading-6 text-slate-500">
          {SIN_NADIE[filtro]}{' '}
          <button type="button" onClick={() => setFiltro('todos')} className="font-semibold text-acento-700 hover:underline">
            Ver todos
          </button>
        </p>
      ) : confirmados.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-slate-50 px-5 py-6 text-center text-sm leading-6 text-slate-500">
          {agenda.length > 0
            ? `Tienes ${resumen.sinLlegar} ${resumen.sinLlegar === 1 ? 'cita' : 'citas'} hoy. Los pacientes aparecen aqui en cuanto registran su llegada en admisiones.`
            : 'No tienes citas programadas para hoy.'}
        </p>
      ) : (
        <ol className="mt-5 space-y-2">
          {visibles.map((item) => {
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
                <span className="text-sm font-semibold tabular-nums text-brand-950 sm:order-none">{sinCodigo ? '' : (item.codigo ?? '—')}</span>
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

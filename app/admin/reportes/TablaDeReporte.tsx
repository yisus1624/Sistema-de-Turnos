'use client'

/**
 * La tabla del reporte: el PACIENTE primero (nombre y documento), despues con
 * quien y cuando, y el turno al final como referencia. Es lo mismo que sale
 * en el PDF (ver `filaDeReporte`). La tabla va por paginas; el PDF, entero.
 */
import { Badge } from '@/components/ui/Badge'
import { Paginacion, usePaginacion } from '@/components/ui/Paginacion'
import { Tabla } from '@/components/admin/Campos'
import { ETIQUETA_ESTADO_TURNO } from '@/components/admin/TablaDeTurnos'
import { horaCorta } from '@/lib/api/cliente'
import type { FilaReporte } from '@/lib/reportes/filas'

/**
 * Cinco columnas y no nueve: lo que va junto se lee junto (medico con su
 * consultorio, las tres horas del recorrido una debajo de otra, el turno con
 * su estado). Asi la tabla cabe entera en un portatil sin desplazarse de lado.
 * El PDF, que es apaisado, si lleva cada dato en su columna.
 */
export const COLUMNAS_DEL_REPORTE = ['Paciente', 'Medico', 'Cita', 'Recorrido', 'Estado']

/** Una hora del recorrido: la etiqueta pequeña y la hora, o una raya si no paso. */
function Hora({ etiqueta, valor }: { etiqueta: string; valor?: string | null }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="w-16 shrink-0 text-xs text-slate-500">{etiqueta}</span>
      <span className="whitespace-nowrap tabular-nums text-slate-700">{horaCorta(valor)}</span>
    </span>
  )
}

const fechaCorta = (fecha: string) =>
  new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${fecha}T12:00:00Z`))

export function TablaDeReporte({
  filas,
  variosDias,
  reinicio,
}: {
  filas: FilaReporte[]
  variosDias: boolean
  /** Los filtros de la consulta: una busqueda nueva vuelve a la primera pagina. */
  reinicio: unknown
}) {
  const pagina = usePaginacion(filas, [reinicio])
  return (
    <>
      <Tabla columnas={COLUMNAS_DEL_REPORTE}>
        {pagina.visibles.map((fila) => {
          const { turno } = fila
          const estado = ETIQUETA_ESTADO_TURNO[turno.estado]
          return (
            <tr key={turno.id} className="align-top hover:bg-slate-50">
              <td className="px-4 py-3">
                <p className="font-semibold text-brand-950">{fila.paciente}</p>
                <p data-cifras className="mt-0.5 text-xs font-medium text-slate-500">
                  {fila.documento}
                </p>
              </td>
              <td className="px-4 py-3">
                <p className="font-medium text-slate-700">{fila.medico}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {fila.servicio} · {fila.consultorio}
                </p>
              </td>
              <td className="px-4 py-3 tabular-nums text-slate-700">
                {variosDias ? <span className="block whitespace-nowrap text-xs text-slate-500">{fechaCorta(fila.fecha)}</span> : null}
                <span className="whitespace-nowrap">{horaCorta(turno.horaCita)}</span>
              </td>
              <td className="space-y-0.5 px-4 py-3">
                <Hora etiqueta="Llegada" valor={turno.fechaGeneracion} />
                <Hora etiqueta="Llamado" valor={turno.horaPrimerLlamado ?? turno.horaLlamado} />
                <Hora etiqueta="Atencion" valor={turno.horaAtencion} />
              </td>
              <td className="px-4 py-3">
                <Badge tone={estado.tono}>{estado.texto}</Badge>
                <p className="mt-1 whitespace-nowrap text-xs font-semibold tabular-nums text-slate-500">Turno {turno.codigo}</p>
              </td>
            </tr>
          )
        })}
      </Tabla>
      <Paginacion {...pagina} />
    </>
  )
}

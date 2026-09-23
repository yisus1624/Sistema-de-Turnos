'use client'

/**
 * La tabla de turnos que comparten el Historico y los Reportes.
 *
 * Estaba copiada en las dos pantallas —columnas, etiquetas de estado y
 * filas— y ya se habian separado: Reportes decia "Ventanilla general" donde
 * el Historico decia "—", para el mismo turno. Vive aqui una sola vez.
 */
import { Badge } from '@/components/ui/Badge'
import { Tabla } from '@/components/admin/Campos'
import { horaCorta } from '@/lib/api/cliente'
import type { EstadoTurno, Turno } from '@/lib/turnos/types'

export const COLUMNAS_DE_TURNOS = ['Turno', 'Servicio', 'Modulo', 'Generado', 'Llamado', 'Cierre', 'Llamadas', 'Estado']

export const ETIQUETA_ESTADO_TURNO: Record<EstadoTurno, { texto: string; tono: 'blue' | 'green' | 'amber' | 'red' | 'slate' }> = {
  EN_ESPERA: { texto: 'En espera', tono: 'slate' },
  LLAMADO: { texto: 'Llamado', tono: 'blue' },
  EN_ATENCION: { texto: 'En atencion', tono: 'blue' },
  ATENDIDO: { texto: 'Atendido', tono: 'green' },
  AUSENTE: { texto: 'Ausente', tono: 'amber' },
  CANCELADO: { texto: 'Cancelado', tono: 'red' },
}

type Catalogo = Array<{ id: string; nombre: string }>

/** El nombre de un servicio o modulo; "—" si ya no esta en el catalogo. */
export function nombreEnCatalogo(lista: Catalogo, id: string): string {
  return lista.find((x) => x.id === id)?.nombre ?? '—'
}

/**
 * El modulo se asigna al LLAMAR: un turno sin modulo es uno que nunca se
 * llamo. Antes Reportes decia "Ventanilla general", que no es lo que paso.
 */
export function nombreDeModulo(lista: Catalogo, id?: string | null): string {
  return id ? nombreEnCatalogo(lista, id) : 'Sin llamar'
}

export function TablaDeTurnos({ turnos, servicios, modulos }: { turnos: Turno[]; servicios: Catalogo; modulos: Catalogo }) {
  return (
    <Tabla columnas={COLUMNAS_DE_TURNOS}>
      {turnos.map((turno) => (
        <tr key={turno.id} className="hover:bg-slate-50">
          <td className="px-4 py-3 font-semibold text-brand-950">{turno.codigo}</td>
          <td className="px-4 py-3 text-slate-600">{nombreEnCatalogo(servicios, turno.servicioId)}</td>
          <td className="px-4 py-3 text-slate-600">{nombreDeModulo(modulos, turno.moduloId)}</td>
          <td className="px-4 py-3 tabular-nums text-slate-600">{horaCorta(turno.fechaGeneracion)}</td>
          <td className="px-4 py-3 tabular-nums text-slate-600">{horaCorta(turno.horaLlamado)}</td>
          <td className="px-4 py-3 tabular-nums text-slate-600">{horaCorta(turno.horaAtencion)}</td>
          <td className="px-4 py-3 tabular-nums text-slate-600">{turno.vecesLlamado}</td>
          <td className="px-4 py-3">
            <Badge tone={ETIQUETA_ESTADO_TURNO[turno.estado].tono}>{ETIQUETA_ESTADO_TURNO[turno.estado].texto}</Badge>
          </td>
        </tr>
      ))}
    </Tabla>
  )
}

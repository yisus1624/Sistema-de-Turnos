'use client'

/**
 * Reportes de turnos: filtra por rango de fechas y descarga un PDF con el
 * logo institucional, pensado para entregar al hospital como constancia.
 *
 * No hay boton de buscar: al mover cualquier filtro la tabla se recarga sola
 * (con un retraso corto, ver `useValorConRetraso`).
 */

import { useCallback, useEffect, useState } from 'react'
import { DownloadSimple, FileText } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { hoyEnColombia, horaCorta, mensajeDeError, pedir } from '@/lib/api/cliente'
import { useValorConRetraso } from '@/lib/hooks'
import { generarReportePdf } from '@/lib/reportes/pdf'
import type { EstadoTurno, Modulo, Servicio, Turno } from '@/lib/turnos/types'

const COLUMNAS = ['Turno', 'Servicio', 'Modulo', 'Generado', 'Llamado', 'Cierre', 'Llamadas', 'Estado']

const etiquetaEstado: Record<EstadoTurno, { texto: string; tono: 'blue' | 'green' | 'amber' | 'red' | 'slate' }> = {
  EN_ESPERA: { texto: 'En espera', tono: 'slate' },
  LLAMADO: { texto: 'Llamado', tono: 'blue' },
  EN_ATENCION: { texto: 'En atencion', tono: 'blue' },
  ATENDIDO: { texto: 'Atendido', tono: 'green' },
  AUSENTE: { texto: 'Ausente', tono: 'amber' },
  CANCELADO: { texto: 'Cancelado', tono: 'red' },
}

type Filtros = {
  fechaDesde: string
  fechaHasta: string
  servicioId: string
  estado: string
}

export default function ReportesClient() {
  const [filtros, setFiltros] = useState<Filtros>(() => {
    const hoy = hoyEnColombia()
    return { fechaDesde: hoy, fechaHasta: hoy, servicioId: '', estado: '' }
  })
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [buscando, setBuscando] = useState(true)
  const [generando, setGenerando] = useState(false)

  const rangoValido = filtros.fechaDesde <= filtros.fechaHasta

  useEffect(() => {
    Promise.all([
      pedir<{ servicios: Servicio[] }>('/api/turnos/servicios'),
      pedir<{ modulos: Modulo[] }>('/api/turnos/modulos'),
    ])
      .then(([s, m]) => {
        setServicios(s.servicios)
        setModulos(m.modulos)
      })
      .catch(() => {})
  }, [])

  const buscar = useCallback(async (activos: Filtros) => {
    setBuscando(true)
    const params = new URLSearchParams()
    for (const [clave, valor] of Object.entries(activos)) {
      if (valor) params.set(clave, valor)
    }

    try {
      const { turnos: lista } = await pedir<{ turnos: Turno[] }>(`/api/turnos/historico?${params}`)
      setTurnos(lista)
    } catch (error) {
      toast.error('No se pudo consultar los turnos', mensajeDeError(error))
    } finally {
      setBuscando(false)
    }
  }, [])

  // Buscar solo cuando el usuario deja de teclear, y nunca con un rango al
  // reves: mientras corrige la fecha no tiene sentido consultar.
  const filtrosDiferidos = useValorConRetraso(filtros)
  useEffect(() => {
    if (filtrosDiferidos.fechaDesde > filtrosDiferidos.fechaHasta) return
    buscar(filtrosDiferidos)
  }, [buscar, filtrosDiferidos])

  const nombre = (lista: Array<{ id: string; nombre: string }>, id?: string | null) =>
    id ? (lista.find((x) => x.id === id)?.nombre ?? '—') : 'Ventanilla general'

  async function descargar() {
    if (turnos.length === 0) {
      toast.error('Nada para descargar', 'No hay turnos en el rango seleccionado.')
      return
    }

    setGenerando(true)
    try {
      await generarReportePdf({
        filas: turnos.map((turno) => ({
          turno,
          servicioNombre: nombre(servicios, turno.servicioId),
          moduloNombre: nombre(modulos, turno.moduloId),
        })),
        fechaDesde: filtros.fechaDesde,
        fechaHasta: filtros.fechaHasta,
      })
    } catch (error) {
      toast.error('No se pudo generar el PDF', mensajeDeError(error))
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Campo etiqueta="Desde">
            <Entrada
              type="date"
              value={filtros.fechaDesde}
              max={filtros.fechaHasta}
              onChange={(e) => setFiltros((f) => ({ ...f, fechaDesde: e.target.value }))}
            />
          </Campo>

          <Campo etiqueta="Hasta">
            <Entrada
              type="date"
              value={filtros.fechaHasta}
              min={filtros.fechaDesde}
              onChange={(e) => setFiltros((f) => ({ ...f, fechaHasta: e.target.value }))}
            />
          </Campo>

          <Campo etiqueta="Servicio">
            <Seleccion
              value={filtros.servicioId}
              onChange={(e) => setFiltros((f) => ({ ...f, servicioId: e.target.value }))}
            >
              <option value="">Todos</option>
              {servicios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Estado">
            <Seleccion
              value={filtros.estado}
              onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value }))}
            >
              <option value="">Todos</option>
              {Object.entries(etiquetaEstado).map(([valor, { texto }]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <div className="flex items-end">
            <Button
              type="button"
              onClick={descargar}
              loading={generando}
              disabled={buscando || turnos.length === 0}
              className="mb-0 w-full"
            >
              <DownloadSimple size={17} weight="bold" />
              Descargar PDF
            </Button>
          </div>
        </div>

        {rangoValido ? null : (
          <p className="mt-3 text-sm font-semibold text-red-600">
            La fecha inicial no puede ser posterior a la final.
          </p>
        )}
      </Card>

      <Card padded={false}>
        <CardHeader>
          <CardTitle>Resultados ({turnos.length})</CardTitle>
        </CardHeader>
        <CardContent padded={false}>
          {buscando ? (
            <TablaSkeleton columnas={COLUMNAS} />
          ) : turnos.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={FileText}
                title="Sin turnos"
                description="No hay turnos en el rango de fechas seleccionado."
              />
            </div>
          ) : (
            <Tabla columnas={COLUMNAS}>
              {turnos.map((turno) => (
                <tr key={turno.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-black text-brand-950">{turno.codigo}</td>
                  <td className="px-4 py-3 text-slate-600">{nombre(servicios, turno.servicioId)}</td>
                  <td className="px-4 py-3 text-slate-600">{nombre(modulos, turno.moduloId)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{horaCorta(turno.fechaGeneracion)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{horaCorta(turno.horaLlamado)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{horaCorta(turno.horaAtencion)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{turno.vecesLlamado}</td>
                  <td className="px-4 py-3">
                    <Badge tone={etiquetaEstado[turno.estado].tono}>{etiquetaEstado[turno.estado].texto}</Badge>
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

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
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Seleccion, TablaSkeleton } from '@/components/admin/Campos'
import {
  COLUMNAS_DE_TURNOS,
  ETIQUETA_ESTADO_TURNO,
  TablaDeTurnos,
  nombreDeModulo,
  nombreEnCatalogo,
} from '@/components/admin/TablaDeTurnos'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import { useCatalogosDeTurnos, useUltimaPeticion, useValorConRetraso } from '@/lib/hooks'
import { generarReportePdf } from '@/lib/reportes/pdf'
import type { Turno } from '@/lib/turnos/types'

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
  // Con reintento, y con aviso si todavia no se pudieron cargar (ver el hook).
  const { servicios, modulos, fallo: falloCatalogos } = useCatalogosDeTurnos()
  const [buscando, setBuscando] = useState(true)
  const [generando, setGenerando] = useState(false)
  // El servidor devuelve como mucho un techo de filas. Si hay mas, el reporte
  // es PARCIAL: se dice en pantalla (fijo, no en un aviso que se va) y en el
  // PDF, que si no diria el rango completo con datos que faltan.
  const [truncado, setTruncado] = useState(false)
  // Los filtros con los que se obtuvo lo que hay en la tabla. El PDF sale con
  // ESTOS, no con los del formulario: si la ultima busqueda fallo, el titulo
  // diria un rango y la tabla traeria otro.
  const [filtrosDeLaTabla, setFiltrosDeLaTabla] = useState<Filtros | null>(null)

  const rangoValido = filtros.fechaDesde <= filtros.fechaHasta


  // La ultima consulta gana: la respuesta lenta de un filtro anterior no puede
  // pisar la tabla (ni el PDF) del filtro que marca la pantalla.
  const consultas = useUltimaPeticion()

  const buscar = useCallback(async (activos: Filtros) => {
    const consulta = consultas.iniciar()
    setBuscando(true)
    const params = new URLSearchParams()
    for (const [clave, valor] of Object.entries(activos)) {
      if (valor) params.set(clave, valor)
    }

    try {
      const { turnos: lista, truncado } = await pedir<{ turnos: Turno[]; truncado?: boolean }>(
        `/api/turnos/historico?${params}`,
        { signal: consulta.signal },
      )
      if (!consulta.esVigente()) return
      setTurnos(lista)
      setTruncado(Boolean(truncado))
      setFiltrosDeLaTabla(activos)
    } catch (error) {
      if (!consulta.esVigente()) return
      // Se vacia: dejar los resultados anteriores bajo un filtro nuevo hacia
      // que se descargara un PDF con datos de una busqueda y titulo de otra.
      setTurnos([])
      setTruncado(false)
      setFiltrosDeLaTabla(null)
      toast.error('No se pudo consultar los turnos', mensajeDeError(error))
    } finally {
      if (consulta.esVigente()) setBuscando(false)
    }
  }, [consultas])

  // Buscar solo cuando el usuario deja de teclear, y nunca con un rango al
  // reves: mientras corrige la fecha no tiene sentido consultar.
  const filtrosDiferidos = useValorConRetraso(filtros)
  useEffect(() => {
    if (filtrosDiferidos.fechaDesde > filtrosDiferidos.fechaHasta) return
    buscar(filtrosDiferidos)
  }, [buscar, filtrosDiferidos])

  async function descargar() {
    if (turnos.length === 0 || !filtrosDeLaTabla) {
      toast.error('Nada para descargar', 'No hay turnos en el rango seleccionado.')
      return
    }

    setGenerando(true)
    try {
      await generarReportePdf({
        filas: turnos.map((turno) => ({
          turno,
          servicioNombre: nombreEnCatalogo(servicios, turno.servicioId),
          moduloNombre: nombreDeModulo(modulos, turno.moduloId),
        })),
        fechaDesde: filtrosDeLaTabla.fechaDesde,
        fechaHasta: filtrosDeLaTabla.fechaHasta,
        parcial: truncado,
      })
    } catch (error) {
      toast.error('No se pudo generar el PDF', mensajeDeError(error))
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="space-y-5">
      {falloCatalogos ? (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          No se pudieron cargar los servicios y consultorios: los nombres pueden salir vacios. Se sigue intentando solo.
        </p>
      ) : null}
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
              {Object.entries(ETIQUETA_ESTADO_TURNO).map(([valor, { texto }]) => (
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

        {truncado ? (
          <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            Hay mas turnos de los que se muestran: el reporte es PARCIAL y el PDF saldra marcado asi. Acota las
            fechas o los filtros para tenerlo completo.
          </p>
        ) : null}

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
            <TablaSkeleton columnas={COLUMNAS_DE_TURNOS} />
          ) : turnos.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={FileText}
                title="Sin turnos"
                description="No hay turnos en el rango de fechas seleccionado."
              />
            </div>
          ) : (
            <TablaDeTurnos turnos={turnos} servicios={servicios} modulos={modulos} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

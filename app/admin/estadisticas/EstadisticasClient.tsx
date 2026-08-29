'use client'

/** Indicadores de atencion (requerimiento seccion 19). */

import { useCallback, useEffect, useState } from 'react'
import { ChartBar } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { Skeleton } from '@/components/ui/Loader'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import type { EstadisticasDia, EstadisticasServicio } from '@/lib/turnos/types'

const COLUMNAS_SERVICIO = ['Servicio', 'Generados', 'Atendidos', 'Ausentes', 'Pendientes', 'Espera', 'Atencion']

function minutos(valor: number | null) {
  return valor === null ? '—' : `${valor} min`
}

/** Un indicador mientras se calcula: mismo alto, para que nada salte al llegar. */
function IndicadorSkeleton() {
  return (
    <Card className="text-center">
      <Skeleton className="mx-auto h-3 w-24" />
      <Skeleton className="mx-auto mt-2 h-8 w-16" />
    </Card>
  )
}

function EstadisticasSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Calculando indicadores">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <IndicadorSkeleton key={i} />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <IndicadorSkeleton key={i} />
        ))}
      </div>
      <Card padded={false}>
        <CardHeader>
          <CardTitle>Por servicio</CardTitle>
        </CardHeader>
        <CardContent padded={false}>
          <TablaSkeleton columnas={COLUMNAS_SERVICIO} filas={4} />
        </CardContent>
      </Card>
    </div>
  )
}

function Indicador({ titulo, valor, tono = 'text-brand-800' }: { titulo: string; valor: string; tono?: string }) {
  return (
    <Card className="text-center">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className={`mt-1 text-3xl font-black tracking-[-0.03em] ${tono}`}>{valor}</p>
    </Card>
  )
}

/** Porcentaje de asistencia: cuantos de los llamados si se presentaron. */
function porcentajeAsistencia(resumen: EstadisticasServicio) {
  const cerrados = resumen.atendidos + resumen.ausentes
  if (cerrados === 0) return '—'
  return `${Math.round((resumen.atendidos / cerrados) * 100)}%`
}

export default function EstadisticasClient() {
  const [fecha, setFecha] = useState(hoyEnColombia())
  const [datos, setDatos] = useState<EstadisticasDia | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async (dia: string) => {
    setCargando(true)
    try {
      const { estadisticas } = await pedir<{ estadisticas: EstadisticasDia }>(
        `/api/turnos/estadisticas?fecha=${dia}`,
      )
      setDatos(estadisticas)
    } catch (error) {
      toast.error('No se pudieron cargar las estadisticas', mensajeDeError(error))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar(fecha)
  }, [cargar, fecha])

  const conMovimiento = datos?.porServicio.filter((s) => s.generados > 0) ?? []

  return (
    <div className="space-y-6">
      <Card>
        <Campo etiqueta="Fecha" className="max-w-xs">
          <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} max={hoyEnColombia()} />
        </Campo>
      </Card>

      {cargando ? (
        <EstadisticasSkeleton />
      ) : !datos || datos.total.generados === 0 ? (
        <EmptyState
          icon={ChartBar}
          title="Sin turnos ese dia"
          description="No se generaron turnos en la fecha seleccionada."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador titulo="Turnos generados" valor={String(datos.total.generados)} />
            <Indicador titulo="Atendidos" valor={String(datos.total.atendidos)} tono="text-emerald-600" />
            <Indicador titulo="Ausentes" valor={String(datos.total.ausentes)} tono="text-amber-600" />
            <Indicador titulo="Pendientes" valor={String(datos.total.pendientes)} tono="text-slate-700" />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Indicador titulo="Espera promedio" valor={minutos(datos.total.minutosEsperaPromedio)} />
            <Indicador titulo="Atencion promedio" valor={minutos(datos.total.minutosAtencionPromedio)} />
            <Indicador titulo="Asistencia" valor={porcentajeAsistencia(datos.total)} />
          </div>

          <Card padded={false}>
            <CardHeader>
              <CardTitle>Por servicio</CardTitle>
            </CardHeader>
            <CardContent padded={false}>
              <Tabla columnas={COLUMNAS_SERVICIO}>
                {conMovimiento.map((servicio) => (
                  <tr key={servicio.servicioId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-black text-brand-950">{servicio.servicioNombre}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{servicio.generados}</td>
                    <td className="px-4 py-3 tabular-nums text-emerald-700">{servicio.atendidos}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700">{servicio.ausentes}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{servicio.pendientes}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {minutos(servicio.minutosEsperaPromedio)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {minutos(servicio.minutosAtencionPromedio)}
                    </td>
                  </tr>
                ))}
              </Tabla>
            </CardContent>
          </Card>

          <Card padded={false}>
            <CardHeader>
              <CardTitle>Turnos atendidos por funcionario</CardTitle>
            </CardHeader>
            <CardContent padded={false}>
              {datos.porFuncionario.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-500">
                  Todavia no hay atenciones cerradas ese dia.
                </p>
              ) : (
                <Tabla columnas={['Funcionario', 'Atendidos']}>
                  {datos.porFuncionario.map((fila) => (
                    <tr key={fila.funcionarioId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-700">{fila.funcionarioId}</td>
                      <td className="px-4 py-3 tabular-nums font-black text-brand-800">{fila.atendidos}</td>
                    </tr>
                  ))}
                </Tabla>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

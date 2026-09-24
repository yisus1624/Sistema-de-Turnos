'use client'

/**
 * Reportes de turnos: elige un periodo, mira el resumen y descarga el PDF con
 * el logo institucional, pensado para entregar al hospital como constancia.
 *
 * ORDEN DE LA PANTALLA, DE LO QUE MAS SE USA A LO QUE MENOS. Primero el
 * periodo, con accesos rapidos (hoy, ayer, la semana, el mes): es lo que se
 * cambia casi siempre y no deberia pedir dos fechas a mano. Despues el
 * resumen en cifras, que es lo que se busca de un vistazo. Y al final la
 * tabla, con la descarga a su lado: el PDF es de ESA tabla.
 *
 * No hay boton de buscar: al mover cualquier filtro la tabla se recarga sola
 * (con un retraso corto, ver `useValorConRetraso`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarBlank,
  CheckCircle,
  Clock,
  DownloadSimple,
  FileText,
  Funnel,
  Ticket,
  UserMinus,
  Warning,
} from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { TarjetaIndicador, TONOS_INDICADOR } from '@/components/ui/TarjetaIndicador'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Seleccion, TablaSkeleton } from '@/components/admin/Campos'
import { ETIQUETA_ESTADO_TURNO } from '@/components/admin/TablaDeTurnos'
import { filaDeReporte } from '@/lib/reportes/filas'
import { COLUMNAS_DEL_REPORTE, TablaDeReporte } from './TablaDeReporte'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import { useCatalogosDeTurnos, useUltimaPeticion, useValorConRetraso } from '@/lib/hooks'
import { generarReportePdf } from '@/lib/reportes/pdf'
import { periodoEnPalabras, rangoDePeriodo, resumirTurnos, type Periodo } from '@/lib/reportes/resumen'
import { esFechaValida } from '@/lib/turnos/tiempo'
import type { EstadoTurno, Turno } from '@/lib/turnos/types'
import { cn } from '@/lib/ui'

type Filtros = {
  fechaDesde: string
  fechaHasta: string
  servicioId: string
  estado: string
}

const PERIODOS: ReadonlyArray<{ valor: Periodo; texto: string }> = [
  { valor: 'hoy', texto: 'Hoy' },
  { valor: 'ayer', texto: 'Ayer' },
  { valor: 'semana', texto: 'Últimos 7 días' },
  { valor: 'mes', texto: 'Este mes' },
  { valor: 'personalizado', texto: 'Personalizado' },
]

/** Color de cada estado en la barra de distribucion (los mismos tonos de sus etiquetas). */
const COLOR_DE_ESTADO: Record<EstadoTurno, string> = {
  ATENDIDO: 'bg-emerald-500',
  LLAMADO: 'bg-brand-500',
  EN_ATENCION: 'bg-brand-300',
  EN_ESPERA: 'bg-slate-300',
  AUSENTE: 'bg-amber-400',
  CANCELADO: 'bg-rose-400',
}

export default function ReportesClient() {
  const [periodo, setPeriodo] = useState<Periodo>('hoy')
  const [filtros, setFiltros] = useState<Filtros>(() => {
    const hoy = hoyEnColombia()
    return { fechaDesde: hoy, fechaHasta: hoy, servicioId: '', estado: '' }
  })
  const [turnos, setTurnos] = useState<Turno[]>([])
  // Con reintento, y con aviso si todavia no se pudieron cargar (ver el hook).
  const { servicios, modulos, profesionales, fallo: falloCatalogos } = useCatalogosDeTurnos()
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
  const resumen = useMemo(() => resumirTurnos(turnos), [turnos])
  // Cada turno ya con paciente, documento, medico y consultorio: lo mismo en la
  // tabla y en el PDF.
  const filas = useMemo(
    () => turnos.map((turno) => filaDeReporte(turno, { servicios, modulos, profesionales })),
    [turnos, servicios, modulos, profesionales],
  )

  // La ultima consulta gana: la respuesta lenta de un filtro anterior no puede
  // pisar la tabla (ni el PDF) del filtro que marca la pantalla.
  const consultas = useUltimaPeticion()

  const buscar = useCallback(
    async (activos: Filtros) => {
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
    },
    [consultas],
  )

  // Buscar solo cuando el usuario deja de teclear, y nunca con un rango al
  // reves: mientras corrige la fecha no tiene sentido consultar.
  const filtrosDiferidos = useValorConRetraso(filtros)
  useEffect(() => {
    if (filtrosDiferidos.fechaDesde > filtrosDiferidos.fechaHasta) return
    buscar(filtrosDiferidos)
  }, [buscar, filtrosDiferidos])

  function elegirPeriodo(valor: Periodo) {
    setPeriodo(valor)
    if (valor === 'personalizado') return
    const { desde, hasta } = rangoDePeriodo(valor, hoyEnColombia())
    setFiltros((f) => ({ ...f, fechaDesde: desde, fechaHasta: hasta }))
  }

  /**
   * Solo entra al estado una fecha que existe. Mientras se corrige con
   * Retroceso el selector queda vacio (o con un año de cinco cifras): se
   * ignora y el campo conserva la ultima fecha buena, en vez de tumbar la
   * pantalla al escribir el periodo.
   */
  function cambiarFecha(campo: 'fechaDesde' | 'fechaHasta', valor: string) {
    if (esFechaValida(valor)) setFiltros((f) => ({ ...f, [campo]: valor }))
  }

  async function descargar() {
    if (turnos.length === 0 || !filtrosDeLaTabla) {
      toast.error('Nada para descargar', 'No hay turnos en el periodo seleccionado.')
      return
    }

    setGenerando(true)
    try {
      await generarReportePdf({
        filas,
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

  const porcentaje = (n: number) => (resumen.total > 0 ? Math.round((n / resumen.total) * 100) : 0)

  return (
    <div className="space-y-5">
      {falloCatalogos ? (
        <Aviso>No se pudieron cargar los servicios y consultorios: los nombres pueden salir vacíos. Se sigue intentando solo.</Aviso>
      ) : null}

      {/* 1. QUE SE QUIERE VER: el periodo primero, y los filtros al lado. */}
      <Card>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <CalendarBlank size={18} weight="duotone" className="text-brand-600" />
              Periodo
            </p>
            <SelectorDePeriodo valor={periodo} alElegir={elegirPeriodo} />
            {periodo === 'personalizado' ? (
              <div className="grid max-w-md grid-cols-2 gap-3 pt-1">
                <Campo etiqueta="Desde">
                  <Entrada
                    type="date"
                    value={filtros.fechaDesde}
                    max={filtros.fechaHasta}
                    onChange={(e) => cambiarFecha('fechaDesde', e.target.value)}
                  />
                </Campo>
                <Campo etiqueta="Hasta">
                  <Entrada
                    type="date"
                    value={filtros.fechaHasta}
                    min={filtros.fechaDesde}
                    onChange={(e) => cambiarFecha('fechaHasta', e.target.value)}
                  />
                </Campo>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:w-[28rem]">
            <Campo etiqueta="Servicio">
              <Seleccion value={filtros.servicioId} onChange={(e) => setFiltros((f) => ({ ...f, servicioId: e.target.value }))}>
                <option value="">Todos los servicios</option>
                {servicios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Estado">
              <Seleccion value={filtros.estado} onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value }))}>
                <option value="">Todos los estados</option>
                {Object.entries(ETIQUETA_ESTADO_TURNO).map(([valor, { texto }]) => (
                  <option key={valor} value={valor}>
                    {texto}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          </div>
        </div>

        {rangoValido ? null : (
          <p className="mt-4 text-sm font-semibold text-rose-600">La fecha inicial no puede ser posterior a la final.</p>
        )}
      </Card>

      {/* 2. EL RESUMEN: lo que se busca de un vistazo. */}
      <section aria-label="Resumen del periodo" className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', buscando && 'opacity-60')}>
        <TarjetaIndicador
          icono={Ticket}
          etiqueta="Turnos"
          valor={resumen.total}
          detalle={truncado ? 'Reporte parcial: acota el periodo' : 'En el periodo y filtros elegidos'}
          tono={TONOS_INDICADOR.acento}
        />
        <TarjetaIndicador
          icono={CheckCircle}
          etiqueta="Atendidos"
          valor={resumen.atendidos}
          detalle={`${porcentaje(resumen.atendidos)} % del total`}
          tono={TONOS_INDICADOR.verde}
        />
        <TarjetaIndicador
          icono={UserMinus}
          etiqueta="Ausentes"
          valor={resumen.ausentes}
          detalle={`${porcentaje(resumen.ausentes)} % del total`}
          tono={TONOS_INDICADOR.ambar}
        />
        <TarjetaIndicador
          icono={Clock}
          etiqueta="Espera promedio (min)"
          valor={resumen.esperaPromedioMin ?? 0}
          detalle={resumen.esperaPromedioMin === null ? 'Aún no se ha llamado a nadie' : 'De la llegada al primer llamado'}
          tono={TONOS_INDICADOR.pizarra}
        />
      </section>

      {resumen.total > 0 ? <DistribucionPorEstado porEstado={resumen.porEstado} total={resumen.total} /> : null}

      {/* 3. EL DETALLE, con la descarga al lado: el PDF es de esta tabla. */}
      <Card padded={false}>
        <CardHeader className="items-center">
          <div className="min-w-0">
            <CardTitle>Pacientes atendidos en el periodo</CardTitle>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-500">
              <Funnel size={14} weight="bold" />
              {periodoEnPalabras(filtros.fechaDesde, filtros.fechaHasta)}
              {' · '}
              <span data-cifras>{turnos.length}</span> {turnos.length === 1 ? 'paciente' : 'pacientes'}
            </p>
          </div>
          <Button type="button" onClick={descargar} loading={generando} disabled={buscando || turnos.length === 0}>
            <DownloadSimple size={17} weight="bold" />
            Descargar PDF
          </Button>
        </CardHeader>

        {truncado ? (
          <div className="px-6 pt-4">
            <Aviso>
              Hay más turnos de los que se muestran: el reporte es PARCIAL y el PDF saldrá marcado así. Acota el periodo o los
              filtros para tenerlo completo.
            </Aviso>
          </div>
        ) : null}

        <CardContent padded={false}>
          {buscando ? (
            <TablaSkeleton columnas={COLUMNAS_DEL_REPORTE} />
          ) : turnos.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={FileText} title="Sin turnos" description="No hay turnos en el periodo y los filtros elegidos." />
            </div>
          ) : (
            <TablaDeReporte
              filas={filas}
              variosDias={filtros.fechaDesde !== filtros.fechaHasta}
              reinicio={filtrosDeLaTabla}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Los periodos rapidos, como un control segmentado: una sola fila de opciones
 * donde la elegida se levanta. Es lo que mas se toca de la pantalla, asi que
 * va primero y sin menus que abrir.
 */
function SelectorDePeriodo({ valor, alElegir }: { valor: Periodo; alElegir: (periodo: Periodo) => void }) {
  return (
    <div role="radiogroup" aria-label="Periodo del reporte" className="inline-flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1">
      {PERIODOS.map((opcion) => {
        const activo = opcion.valor === valor
        return (
          <button
            key={opcion.valor}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => alElegir(opcion.valor)}
            className={cn(
              'rounded-xl px-3.5 py-2 text-sm font-semibold tracking-[-0.01em] transition-[background-color,color,box-shadow] duration-150 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
              activo
                ? 'bg-white text-brand-950 shadow-[0_1px_2px_rgba(10,38,52,.08),0_2px_8px_rgba(10,38,52,.06)]'
                : 'text-slate-600 hover:bg-white/60 hover:text-brand-950',
            )}
          >
            {opcion.texto}
          </button>
        )
      })}
    </div>
  )
}

/** Como se repartieron los turnos por estado: una barra proporcional y su leyenda. */
function DistribucionPorEstado({ porEstado, total }: { porEstado: Record<EstadoTurno, number>; total: number }) {
  const presentes = (Object.keys(COLOR_DE_ESTADO) as EstadoTurno[]).filter((estado) => porEstado[estado] > 0)
  return (
    <Card>
      <p className="text-sm font-semibold text-slate-700">Distribución por estado</p>
      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Turnos por estado">
        {presentes.map((estado) => (
          <span key={estado} className={COLOR_DE_ESTADO[estado]} style={{ width: `${(porEstado[estado] / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {presentes.map((estado) => (
          <li key={estado} className="flex items-center gap-2 text-sm text-slate-600">
            <span className={cn('h-2.5 w-2.5 rounded-full', COLOR_DE_ESTADO[estado])} aria-hidden />
            <span className="font-medium">{ETIQUETA_ESTADO_TURNO[estado].texto}</span>
            <span data-cifras className="font-semibold text-brand-950">
              {porEstado[estado]}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
      <Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
      <span>{children}</span>
    </p>
  )
}

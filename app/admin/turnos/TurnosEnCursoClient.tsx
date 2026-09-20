'use client'

/**
 * Vista general de la operacion del dia (requerimiento secciones 8 y 13).
 *
 * Se actualiza sola: escucha los mismos eventos en vivo que la pantalla de la
 * sala de espera y se pone al dia sola cuando la conexion se restablece. El
 * indicador del encabezado dice si lo que se ve sigue siendo cierto.
 */

import { useCallback, useEffect, useState } from 'react'
import { Ticket } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Loader'
import { hoyEnColombia, horaCorta, pedir } from '@/lib/api/cliente'
import { useRecargaEnVivo } from '@/lib/hooks'
import { IndicadorConexion } from '@/components/ui/IndicadorConexion'
import type { CasillaPantalla, Servicio, Turno } from '@/lib/turnos/types'

type Resumen = { enEspera: number; llamados: number; atendidos: number; ausentes: number }

function contar(turnos: Turno[]): Resumen {
  return {
    enEspera: turnos.filter((t) => t.estado === 'EN_ESPERA').length,
    llamados: turnos.filter((t) => t.estado === 'LLAMADO' || t.estado === 'EN_ATENCION').length,
    atendidos: turnos.filter((t) => t.estado === 'ATENDIDO').length,
    ausentes: turnos.filter((t) => t.estado === 'AUSENTE').length,
  }
}

function Indicador({ titulo, valor, tono }: { titulo: string; valor: number; tono: string }) {
  return (
    <Card className="text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className={`mt-1 text-4xl font-semibold tracking-[-0.03em] ${tono}`}>{valor}</p>
    </Card>
  )
}

export default function TurnosEnCursoClient() {
  const [casillas, setCasillas] = useState<CasillaPantalla[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    try {
      // La fecha se calcula en CADA carga, no al montar: esta pantalla vive
      // abierta en el puesto del administrador y tiene que pasar sola al dia
      // siguiente.
      //
      // Sin este filtro se pedia el historico COMPLETO y con el se calculaban
      // los cuatro indicadores y la espera por servicio: los turnos de dias
      // anteriores (incluidos los que quedaron colgados en EN_ESPERA al cerrar
      // la jornada) sumaban en el tablero de "hoy".
      const [pantalla, historico, catalogo] = await Promise.all([
        pedir<{ casillas: CasillaPantalla[] }>('/api/turnos/pantalla'),
        pedir<{ turnos: Turno[] }>(`/api/turnos/historico?fecha=${hoyEnColombia()}`),
        pedir<{ servicios: Servicio[] }>('/api/turnos/servicios'),
      ])
      setCasillas(pantalla.casillas)
      setTurnos(historico.turnos)
      setServicios(catalogo.servicios)
    } catch {
      // Silencioso: es una vista que se refresca sola, no vale la pena molestar
      // con un aviso en cada intento fallido.
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Eventos en vivo (agrupados): el mismo patron que usan el operador y el
  // consultorio, en `useRecargaEnVivo`.
  const conexion = useRecargaEnVivo(cargar)

  const resumen = contar(turnos)
  const ocupados = casillas.filter((c) => c.codigo)

  /**
   * Los servicios que hoy estan funcionando.
   *
   * Se deducen de los turnos del dia y de las casillas de la pantalla, que es
   * lo que de verdad se movio hoy, no del catalogo: ahi figuran tambien los que
   * el hospital atiende otros dias. Si todavia no ha pasado nada —a primera
   * hora— se muestran todos, porque un tablero vacio al abrir se lee como que
   * el sistema no cargo.
   */
  const idsDeHoy = new Set([...turnos.map((t) => t.servicioId), ...casillas.map((c) => c.servicioId)])
  const serviciosDeHoy = idsDeHoy.size > 0 ? servicios.filter((s) => idsDeHoy.has(s.id)) : servicios

  if (cargando) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Cargando la operacion del dia">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="text-center">
              <Skeleton className="mx-auto h-3 w-24" />
              <Skeleton className="mx-auto mt-2 h-9 w-14" />
            </Card>
          ))}
        </div>

        <Card padded={false}>
          <CardHeader>
            <CardTitle>Puntos de atencion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="mt-2 h-8 w-24" />
                  <Skeleton className="mt-2 h-3 w-40 max-w-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card padded={false}>
          <CardHeader>
            <CardTitle>En espera por servicio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3"
                >
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-6 w-8" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="En espera" valor={resumen.enEspera} tono="text-slate-700" />
        <Indicador titulo="En atencion" valor={resumen.llamados} tono="text-brand-600" />
        <Indicador titulo="Atendidos" valor={resumen.atendidos} tono="text-emerald-600" />
        <Indicador titulo="Ausentes" valor={resumen.ausentes} tono="text-amber-600" />
      </div>

      <Card padded={false}>
        <CardHeader>
          <CardTitle>Puntos de atencion ({ocupados.length} ocupados de {casillas.length})</CardTitle>
          <IndicadorConexion estado={conexion} />
        </CardHeader>
        <CardContent>
          {casillas.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="Sin modulos configurados"
              description="Crea consultorios y ventanillas desde el modulo de modulos y ventanillas."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {casillas.map((casilla) => (
                <div
                  key={casilla.moduloId}
                  className={`rounded-xl border px-4 py-3 ${
                    casilla.codigo ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
                    {casilla.moduloNombre}
                    {casilla.profesionalNombre ? ` · ${casilla.profesionalNombre}` : ''}
                  </p>
                  {casilla.codigo ? (
                    <>
                      <p className="mt-1 text-3xl font-semibold tracking-[-0.02em] text-brand-800">{casilla.codigo}</p>
                      <p className="truncate text-sm font-bold text-slate-600">
                        {casilla.servicioNombre}
                        {casilla.horaLlamado ? ` · ${horaCorta(casilla.horaLlamado)}` : ''}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-lg font-bold text-slate-400">Libre</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card padded={false}>
        <CardHeader>
          <CardTitle>En espera por servicio</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/*
              SOLO LOS SERVICIOS QUE HOY TIENEN ALGO. El catalogo lo va llenando
              la carga del reporte del hospital y de ahi nada se apaga, asi que
              listarlos todos llenaba el tablero de tarjetas en cero de
              servicios que hoy no atienden: el numero que importa —donde hay
              cola— quedaba escondido entre ceros.
            */}
            {serviciosDeHoy.map((servicio) => {
              const enEspera = turnos.filter((t) => t.servicioId === servicio.id && t.estado === 'EN_ESPERA')
              return (
                <div key={servicio.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
                  <span className="truncate font-bold text-slate-700">{servicio.nombre}</span>
                  <span className="text-2xl font-semibold tabular-nums text-brand-800">{enEspera.length}</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

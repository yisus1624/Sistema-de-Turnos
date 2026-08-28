'use client'

/**
 * Vista general de la operacion del dia (requerimiento secciones 8 y 13).
 *
 * Se actualiza sola: escucha los mismos eventos en vivo que la pantalla de la
 * sala de espera y ademas refresca cada 15 segundos, para reflejar tambien lo
 * que no genera evento (llegadas registradas en admisiones).
 */

import { useCallback, useEffect, useState } from 'react'
import { Ticket } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { horaCorta, pedir } from '@/lib/api/cliente'
import type { CasillaPantalla, Servicio, Turno } from '@/lib/turnos/types'

const MS_REFRESCO = 15000

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
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className={`mt-1 text-4xl font-black tracking-[-0.03em] ${tono}`}>{valor}</p>
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
      const [pantalla, historico, catalogo] = await Promise.all([
        pedir<{ casillas: CasillaPantalla[] }>('/api/turnos/pantalla'),
        pedir<{ turnos: Turno[] }>('/api/turnos/historico'),
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
    const id = setInterval(cargar, MS_REFRESCO)
    return () => clearInterval(id)
  }, [cargar])

  useEffect(() => {
    const es = new EventSource('/api/turnos/stream')
    es.onmessage = () => cargar()
    return () => es.close()
  }, [cargar])

  const resumen = contar(turnos)
  const ocupados = casillas.filter((c) => c.codigo)

  if (cargando) {
    return <p className="py-10 text-center text-sm text-slate-500">Cargando la operacion del dia...</p>
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
          <Badge tone="green">En vivo</Badge>
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
                  <p className="truncate text-xs font-black uppercase tracking-wide text-slate-500">
                    {casilla.moduloNombre}
                    {casilla.profesionalNombre ? ` · ${casilla.profesionalNombre}` : ''}
                  </p>
                  {casilla.codigo ? (
                    <>
                      <p className="mt-1 text-3xl font-black tracking-[-0.02em] text-brand-800">{casilla.codigo}</p>
                      <p className="truncate text-sm font-bold text-slate-600">
                        {casilla.pacienteVisible ?? casilla.servicioNombre}
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
            {servicios.map((servicio) => {
              const enEspera = turnos.filter((t) => t.servicioId === servicio.id && t.estado === 'EN_ESPERA')
              return (
                <div key={servicio.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
                  <span className="truncate font-bold text-slate-700">{servicio.nombre}</span>
                  <span className="text-2xl font-black tabular-nums text-brand-800">{enEspera.length}</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

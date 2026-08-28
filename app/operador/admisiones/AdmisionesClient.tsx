'use client'

/**
 * Registro de llegada en admisiones.
 *
 * Es el paso que convierte una cita de la agenda en un turno en espera: el
 * paciente llega, da su documento, el funcionario confirma que se presento y
 * desde ese momento aparece en la fila de su profesional.
 *
 * El documento y el nombre completo solo se ven aqui, en una pantalla con
 * sesion. Hacia la pantalla de la sala de espera el nombre viaja enmascarado.
 */

import { useState } from 'react'
import { CheckCircle, MagnifyingGlass, UserFocus } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import type { Cita, Turno } from '@/lib/turnos/types'

async function pedir<T>(url: string, opciones?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...opciones?.headers },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? 'Ocurrio un error inesperado.')
  return data as T
}

function horaCorta(iso: string) {
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

const etiquetaEstado: Record<Cita['estado'], { texto: string; tono: 'blue' | 'green' | 'amber' | 'red' }> = {
  PROGRAMADA: { texto: 'Programada', tono: 'blue' },
  PRESENTADO: { texto: 'Ya registro llegada', tono: 'amber' },
  ATENDIDA: { texto: 'Atendida', tono: 'green' },
  CANCELADA: { texto: 'Cancelada', tono: 'red' },
}

export default function AdmisionesClient() {
  const [documento, setDocumento] = useState('')
  const [citas, setCitas] = useState<Cita[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [registrando, setRegistrando] = useState<string | null>(null)
  const [ultimoTurno, setUltimoTurno] = useState<Turno | null>(null)

  async function buscar(evento: React.FormEvent) {
    evento.preventDefault()
    if (documento.trim().length < 4) {
      toast.error('Documento incompleto', 'Ingresa al menos 4 digitos.')
      return
    }

    setBuscando(true)
    setUltimoTurno(null)
    try {
      const { citas: encontradas } = await pedir<{ citas: Cita[] }>(
        `/api/turnos/citas?documento=${encodeURIComponent(documento.trim())}`,
      )
      setCitas(encontradas)
      if (encontradas.length === 0) {
        toast.info('Sin citas', 'No hay citas para ese documento el dia de hoy.')
      }
    } catch (error) {
      toast.error('No se pudo buscar', error instanceof Error ? error.message : undefined)
    } finally {
      setBuscando(false)
    }
  }

  async function registrarLlegada(cita: Cita) {
    setRegistrando(cita.id)
    try {
      const { turno } = await pedir<{ turno: Turno }>('/api/turnos/citas/llegada', {
        method: 'POST',
        body: JSON.stringify({ citaId: cita.id }),
      })
      setUltimoTurno(turno)
      setCitas((previas) =>
        previas?.map((c) => (c.id === cita.id ? { ...c, estado: 'PRESENTADO' } : c)) ?? null,
      )
      toast.success('Llegada registrada', `Turno ${turno.codigo} para ${cita.nombrePaciente}.`)
    } catch (error) {
      toast.error('No se pudo registrar la llegada', error instanceof Error ? error.message : undefined)
    } finally {
      setRegistrando(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Buscar al paciente</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={buscar} className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1">
              <span className="mb-1.5 block text-sm font-bold text-slate-700">Numero de documento</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder="Cedula del paciente"
                className="h-12 w-full rounded-xl border border-slate-200 px-4 text-base font-semibold text-brand-950 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
            </label>
            <Button type="submit" loading={buscando} className="sm:mt-7">
              <MagnifyingGlass size={18} weight="bold" />
              Buscar
            </Button>
          </form>
        </CardContent>
      </Card>

      {ultimoTurno ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-5 text-center">
          <p className="text-sm font-bold uppercase tracking-wide text-emerald-700">Turno asignado</p>
          <p className="mt-1 text-5xl font-black tracking-[-0.03em] text-emerald-900">{ultimoTurno.codigo}</p>
          <p className="mt-2 text-sm font-semibold text-emerald-800">
            Indicale al paciente que espere a que lo llamen en la pantalla.
          </p>
        </div>
      ) : null}

      {citas === null ? (
        <EmptyState
          icon={UserFocus}
          title="Busca por documento"
          description="Escribe el numero de documento del paciente para ver sus citas de hoy y registrar su llegada."
        />
      ) : citas.length === 0 ? (
        <EmptyState
          icon={UserFocus}
          title="Sin citas para ese documento"
          description="Verifica el numero. Si el paciente no tiene cita, atiendelo por la fila de ventanilla."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Citas de hoy ({citas.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {citas.map((cita) => {
                const estado = etiquetaEstado[cita.estado]
                const puedeRegistrar = cita.estado === 'PROGRAMADA'

                return (
                  <li
                    key={cita.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-brand-950">{cita.nombrePaciente}</p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {horaCorta(cita.horaCita)} · documento {cita.documentoPaciente}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone={estado.tono}>{estado.texto}</Badge>
                      {puedeRegistrar ? (
                        <Button
                          size="sm"
                          loading={registrando === cita.id}
                          onClick={() => registrarLlegada(cita)}
                        >
                          <CheckCircle size={17} weight="bold" />
                          Registrar llegada
                        </Button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

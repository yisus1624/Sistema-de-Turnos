'use client'

/**
 * Agenda de citas del operador.
 *
 * TEMPORAL: en produccion las citas las trae la API del hospital. Mientras esa
 * API no exista, el operador las carga a mano aqui: registra al paciente y le
 * asigna un profesional. De cada cita creada sale luego el turno, cuando el
 * paciente llega y se registra su llegada en "Registro de llegada".
 *
 * El documento y el nombre completo solo se manejan en esta pantalla CON
 * sesion; nunca salen hacia la pantalla de la sala de espera.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Plus, Trash } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { hoyEnColombia, horaCorta, mensajeDeError, pedir } from '@/lib/api/cliente'
import type { Cita, Profesional, Servicio } from '@/lib/turnos/types'

const COLUMNAS = ['Hora', 'Paciente', 'Documento', 'Profesional', 'Servicio', 'Estado', '']

type Formulario = {
  documentoPaciente: string
  nombrePaciente: string
  profesionalId: string
  hora: string
}

function formularioVacio(): Formulario {
  return { documentoPaciente: '', nombrePaciente: '', profesionalId: '', hora: '08:00' }
}

const etiquetaEstado: Record<Cita['estado'], { texto: string; tono: 'blue' | 'amber' | 'green' | 'red' | 'slate' }> = {
  PROGRAMADA: { texto: 'Programada', tono: 'blue' },
  PRESENTADO: { texto: 'Ya llego', tono: 'amber' },
  ATENDIDA: { texto: 'Atendida', tono: 'green' },
  CANCELADA: { texto: 'Cancelada', tono: 'slate' },
}

export default function AgendaClient() {
  const [fecha, setFecha] = useState(hoyEnColombia())
  const [citas, setCitas] = useState<Cita[]>([])
  const [profesionales, setProfesionales] = useState<Profesional[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const [formulario, setFormulario] = useState<Formulario>(formularioVacio)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    Promise.all([
      pedir<{ profesionales: Profesional[] }>('/api/turnos/profesionales'),
      pedir<{ servicios: Servicio[] }>('/api/turnos/servicios'),
    ])
      .then(([p, s]) => {
        setProfesionales(p.profesionales)
        setServicios(s.servicios)
      })
      .catch((error) => toast.error('No se pudieron cargar los catalogos', mensajeDeError(error)))
  }, [])

  const cargarCitas = useCallback(async (dia: string) => {
    setCargando(true)
    try {
      const { citas: lista } = await pedir<{ citas: Cita[] }>(`/api/turnos/agenda?fecha=${dia}`)
      setCitas(lista)
    } catch (error) {
      toast.error('No se pudo cargar la agenda', mensajeDeError(error))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargarCitas(fecha)
  }, [cargarCitas, fecha])

  const nombreProfesional = useMemo(() => {
    const mapa = new Map(profesionales.map((p) => [p.id, p.nombre]))
    return (id: string) => mapa.get(id) ?? '—'
  }, [profesionales])

  const nombreServicio = useMemo(() => {
    const mapa = new Map(servicios.map((s) => [s.id, s.nombre]))
    return (id: string) => mapa.get(id) ?? '—'
  }, [servicios])

  function abrirNueva() {
    setFormulario({ ...formularioVacio(), profesionalId: profesionales[0]?.id ?? '' })
    setAbierto(true)
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    setGuardando(true)

    // La hora del formulario (HH:MM) se ancla a la fecha seleccionada, en hora
    // local del navegador, que es la del hospital.
    const horaCita = new Date(`${fecha}T${formulario.hora}:00`).toISOString()

    try {
      await pedir('/api/turnos/agenda', {
        method: 'POST',
        body: JSON.stringify({
          documentoPaciente: formulario.documentoPaciente,
          nombrePaciente: formulario.nombrePaciente,
          profesionalId: formulario.profesionalId,
          horaCita,
        }),
      })
      toast.success('Cita agendada', `${formulario.nombrePaciente} con ${nombreProfesional(formulario.profesionalId)}.`)
      setAbierto(false)
      await cargarCitas(fecha)
    } catch (error) {
      toast.error('No se pudo agendar', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  async function cancelar(cita: Cita) {
    try {
      await pedir(`/api/turnos/agenda/${cita.id}`, { method: 'DELETE' })
      toast.info('Cita cancelada', cita.nombrePaciente)
      await cargarCitas(fecha)
    } catch (error) {
      toast.error('No se pudo cancelar', mensajeDeError(error))
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Campo etiqueta="Fecha" className="max-w-xs">
            <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <Button onClick={abrirNueva} disabled={profesionales.length === 0}>
            <Plus size={17} weight="bold" />
            Nueva cita
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        <CardHeader>
          <CardTitle>Citas del dia ({citas.length})</CardTitle>
        </CardHeader>
        <CardContent padded={false}>
          {cargando ? (
            <TablaSkeleton columnas={COLUMNAS} />
          ) : citas.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={CalendarPlus}
                title="Sin citas ese dia"
                description="Agenda la primera cita: registra al paciente y asignale un profesional."
              />
            </div>
          ) : (
            <Tabla columnas={COLUMNAS}>
              {citas.map((cita) => {
                const estado = etiquetaEstado[cita.estado]
                return (
                  <tr key={cita.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 tabular-nums font-black text-brand-950">{horaCorta(cita.horaCita)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{cita.nombrePaciente}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{cita.documentoPaciente}</td>
                    <td className="px-4 py-3 text-slate-600">{nombreProfesional(cita.profesionalId)}</td>
                    <td className="px-4 py-3 text-slate-600">{nombreServicio(cita.servicioId)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={estado.tono}>{estado.texto}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {cita.estado === 'PROGRAMADA' ? (
                        <Button size="sm" variant="ghost" onClick={() => cancelar(cita)}>
                          <Trash size={16} />
                          Cancelar
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </Tabla>
          )}
        </CardContent>
      </Card>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title="Nueva cita"
        description="Registra al paciente y asignale el profesional que lo va a atender."
      >
        <form onSubmit={guardar} className="space-y-4">
          <Campo etiqueta="Documento del paciente">
            <Entrada
              inputMode="numeric"
              value={formulario.documentoPaciente}
              onChange={(e) => setFormulario((f) => ({ ...f, documentoPaciente: e.target.value }))}
              placeholder="1067890123"
              required
              minLength={4}
            />
          </Campo>

          <Campo etiqueta="Nombre del paciente">
            <Entrada
              value={formulario.nombrePaciente}
              onChange={(e) => setFormulario((f) => ({ ...f, nombrePaciente: e.target.value }))}
              placeholder="Juan Carlos Perez"
              required
              minLength={3}
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Profesional">
              <Seleccion
                value={formulario.profesionalId}
                onChange={(e) => setFormulario((f) => ({ ...f, profesionalId: e.target.value }))}
                required
              >
                {profesionales.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} · {nombreServicio(p.servicioId)}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <Campo etiqueta="Hora">
              <Entrada
                type="time"
                value={formulario.hora}
                onChange={(e) => setFormulario((f) => ({ ...f, hora: e.target.value }))}
                required
              />
            </Campo>
          </div>

          <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
            Cita para el <strong className="font-black">{fecha}</strong>. El turno se genera despues, cuando el
            paciente llegue y registres su llegada.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={guardando}>
              Agendar cita
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

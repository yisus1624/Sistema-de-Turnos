'use client'

/**
 * Interfaz del funcionario (requerimiento secciones 9, 12 y 13).
 *
 * Solo cubre la fila compartida por orden de llegada (admisiones, facturacion,
 * SIAU, autorizaciones). Los servicios que atienden por cita (consulta
 * externa, odontologia, pediatria) ya no se llaman desde aqui: cada
 * profesional pasa sus propios turnos desde su enlace personal
 * (`/consultorio/[token]`, ver `app/admin/profesionales`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowClockwise, CheckCircle, Megaphone, UserMinus } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
// El cliente COMPARTIDO, no una copia local: la copia se quedaba fuera del
// manejo de sesion caducada (ver `lib/api/cliente.ts`).
import { horaCorta, pedir } from '@/lib/api/cliente'
import { useRecargaEnVivo } from '@/lib/hooks'
import { afectaALaFila } from '@/lib/realtime/canal'
import { IndicadorConexion } from '@/components/ui/IndicadorConexion'
import type { Modulo, Servicio, Turno } from '@/lib/turnos/types'

type Accion = 'generar' | 'llamar' | 'repetir' | 'atendido' | 'ausente' | null

const claseCampo =
  'h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold text-brand-950 outline-none focus:border-brand-500'

export default function OperadorClient() {
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])

  const [servicioId, setServicioId] = useState('')
  const [moduloId, setModuloId] = useState('')

  const [pendientes, setPendientes] = useState<Turno[]>([])
  const [turnoActual, setTurnoActual] = useState<Turno | null>(null)
  const [cargando, setCargando] = useState<Accion>(null)
  const [catalogosListos, setCatalogosListos] = useState(false)

  const servicio = useMemo(() => servicios.find((s) => s.id === servicioId), [servicios, servicioId])
  const listoParaLlamar = Boolean(moduloId && servicioId)

  useEffect(() => {
    Promise.all([
      pedir<{ servicios: Servicio[] }>('/api/turnos/servicios'),
      pedir<{ modulos: Modulo[] }>('/api/turnos/modulos'),
    ])
      .then(([s, m]) => {
        // Solo ventanillas: los servicios por cita los pasa el profesional
        // desde su propio enlace, no el operador.
        const compartidos = s.servicios.filter((servicio) => servicio.modoFila === 'COMPARTIDA')
        setServicios(compartidos)
        setModulos(m.modulos)
        if (compartidos[0]) setServicioId((actual) => actual || compartidos[0].id)
      })
      .catch((error) => toast.error('No se pudieron cargar los catalogos', error.message))
      .finally(() => setCatalogosListos(true))
  }, [])

  // Al cambiar de servicio, la ventanilla anterior deja de tener sentido: se
  // preselecciona la primera disponible.
  useEffect(() => {
    if (!servicio) return

    const modulosServicio = modulos.filter((m) => !m.servicioId || m.servicioId === servicio.id)
    setModuloId(modulosServicio[0]?.id ?? '')

    setTurnoActual(null)
  }, [servicio, modulos])

  const cargarPendientes = useCallback(async () => {
    if (!servicioId) return

    try {
      const { pendientes: lista } = await pedir<{ pendientes: Turno[] }>(
        `/api/turnos/pendientes?servicioId=${encodeURIComponent(servicioId)}`,
      )
      setPendientes(lista)
    } catch (error) {
      toast.error('No se pudieron cargar los pendientes', error instanceof Error ? error.message : undefined)
    }
  }, [servicioId])

  useEffect(() => {
    cargarPendientes()
  }, [cargarPendientes])

  /**
   * La fila compartida la atienden VARIAS ventanillas a la vez.
   *
   * Sin esto, la lista solo se recargaba despues de una accion de este mismo
   * operador: la ventanilla 2 seguia viendo en espera a alguien que la
   * ventanilla 1 ya atendio (y podia volver a llamarlo), y un turno generado en
   * otra ventanilla no aparecia hasta que pulsara algo. Entre dos ventanillas,
   * asi es como se pierde de vista a un paciente.
   */
  const conexion = useRecargaEnVivo(cargarPendientes, {
    activo: Boolean(servicioId),
    interesa: (evento) => afectaALaFila(evento, { servicioId }),
  })

  async function ejecutar(accion: Accion, tarea: () => Promise<void>) {
    setCargando(accion)
    try {
      await tarea()
    } catch (error) {
      toast.error('No se pudo completar la accion', error instanceof Error ? error.message : undefined)
    } finally {
      setCargando(null)
    }
  }

  const generarTurno = () =>
    ejecutar('generar', async () => {
      const { turno } = await pedir<{ turno: Turno }>('/api/turnos/ventanilla', {
        method: 'POST',
        body: JSON.stringify({ servicioId }),
      })
      toast.success('Turno generado', `Se genero el turno ${turno.codigo}.`)
      await cargarPendientes()
    })

  const llamarSiguiente = () =>
    ejecutar('llamar', async () => {
      const { turno } = await pedir<{ turno: Turno }>('/api/turnos/llamar-siguiente', {
        method: 'POST',
        body: JSON.stringify({ servicioId, moduloId }),
      })
      setTurnoActual(turno)
      toast.success('Turno llamado', `${turno.codigo}${turno.nombrePaciente ? ` · ${turno.nombrePaciente}` : ''}`)
      await cargarPendientes()
    })

  const repetirLlamado = () =>
    ejecutar('repetir', async () => {
      if (!turnoActual) return
      const { turno } = await pedir<{ turno: Turno }>(`/api/turnos/${turnoActual.id}/repetir`, { method: 'POST' })
      setTurnoActual(turno)
      toast.info('Llamado repetido', `Se repitio el turno ${turno.codigo}.`)
    })

  const cerrarTurno = (accion: 'atendido' | 'ausente') =>
    ejecutar(accion, async () => {
      if (!turnoActual) return
      await pedir(`/api/turnos/${turnoActual.id}/${accion}`, { method: 'POST' })
      if (accion === 'atendido') {
        toast.success('Atencion finalizada', `El turno ${turnoActual.codigo} quedo como atendido.`)
      } else {
        toast.warning('Paciente ausente', `El turno ${turnoActual.codigo} no se presento.`)
      }
      setTurnoActual(null)
      await cargarPendientes()
    })

  // Las ventanillas son genericas: sirven para cualquier fila compartida.
  const modulosDisponibles = modulos.filter((m) => !m.servicioId || m.servicioId === servicioId)

  /**
   * Esta pantalla es solo para las filas por ORDEN DE LLEGADA. Hoy el hospital
   * atiende todo por cita, asi que normalmente no hay ninguna configurada y sin
   * este aviso el operador se encontraba dos desplegables vacios y un boton que
   * no hace nada, sin ninguna explicacion.
   */
  if (catalogosListos && servicios.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No hay filas por orden de llegada"
        description="Esta pantalla sirve para los servicios que se atienden sin cita, por orden de llegada. Hoy no hay ninguno configurado: cada doctor llama a sus propios pacientes desde su consultorio. Si se abre una ventanilla, se crea el servicio en Servicios con modo de fila 'Ventanilla' y aparece aqui."
      />
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Donde estas atendiendo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-slate-700">Servicio</span>
            <select className={claseCampo} value={servicioId} onChange={(e) => setServicioId(e.target.value)}>
              {servicios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre} ({s.prefijo})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-slate-700">Ventanilla</span>
            <select className={claseCampo} value={moduloId} onChange={(e) => setModuloId(e.target.value)}>
              {modulosDisponibles.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Atendiendo ahora</CardTitle>
          {servicio ? <Badge tone="blue">{servicio.nombre}</Badge> : null}
        </CardHeader>
        <CardContent className="space-y-5">
          {turnoActual ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
              <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Turno</p>
              <p className="mt-1 text-5xl font-semibold tracking-[-0.03em] text-brand-950">{turnoActual.codigo}</p>
              {turnoActual.nombrePaciente ? (
                <p className="mt-2 text-xl font-semibold text-slate-800">{turnoActual.nombrePaciente}</p>
              ) : null}
              <p className="mt-2 text-sm text-slate-600">
                Llamado {turnoActual.vecesLlamado} {turnoActual.vecesLlamado === 1 ? 'vez' : 'veces'}
                {turnoActual.horaLlamado ? ` · ${horaCorta(turnoActual.horaLlamado)}` : ''}
              </p>
            </div>
          ) : (
            <EmptyState
              icon={Megaphone}
              title="Sin paciente en atencion"
              description="Pulsa siguiente para llamar al proximo paciente en espera."
            />
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={llamarSiguiente} loading={cargando === 'llamar'} disabled={!listoParaLlamar}>
              <Megaphone size={18} weight="bold" />
              Siguiente paciente
            </Button>
            <Button onClick={repetirLlamado} loading={cargando === 'repetir'} variant="secondary" disabled={!turnoActual}>
              <ArrowClockwise size={18} weight="bold" />
              Repetir llamado
            </Button>
            <Button onClick={() => cerrarTurno('atendido')} loading={cargando === 'atendido'} variant="dark" disabled={!turnoActual}>
              <CheckCircle size={18} weight="bold" />
              Atendido
            </Button>
            <Button onClick={() => cerrarTurno('ausente')} loading={cargando === 'ausente'} variant="danger" disabled={!turnoActual}>
              <UserMinus size={18} weight="bold" />
              No se presento
            </Button>
            {servicio ? (
              <Button onClick={generarTurno} loading={cargando === 'generar'} variant="secondary">
                Generar turno
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>En espera ({pendientes.length})</CardTitle>
          <IndicadorConexion estado={conexion} />
        </CardHeader>
        <CardContent>
          {pendientes.length === 0 ? (
            <p className="text-sm text-slate-500">No hay turnos en espera para este servicio.</p>
          ) : (
            <ol className="space-y-2">
              {pendientes.map((turno, indice) => (
                <li
                  key={turno.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-2.5 text-sm"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-medium text-slate-600">
                    {indice + 1}
                  </span>
                  <span className="font-semibold text-brand-950">{turno.codigo}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{turno.nombrePaciente ?? '—'}</span>
                  {turno.prioridad === 'PRIORITARIO' ? <Badge tone="amber">Prioritario</Badge> : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

'use client'

/**
 * Pantalla del doctor (acceso por enlace temporal, sin usuario ni contrasena).
 *
 * Pensada para usarse rapido entre paciente y paciente: el boton principal es
 * grande porque el doctor la usa de pie o entre dos consultas, no sentado
 * revisando un formulario. El nombre completo del paciente SI se muestra
 * aqui (es el medico tratante, no la pantalla publica).
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowClockwise,
  CheckCircle,
  Megaphone,
  Stethoscope,
  UserMinus,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { horaCorta, mensajeDeError, pedir } from '@/lib/api/cliente'
import { Isotipo, NOMBRE_INSTITUCION } from '@/components/brand/Marca'
import type { Modulo, Profesional, Turno } from '@/lib/turnos/types'

type Accion = 'llamar' | 'repetir' | 'atendido' | 'ausente' | null

const claseCampo =
  'h-11 w-full max-w-xs rounded-xl border border-slate-200 px-3 text-sm font-semibold text-brand-950 outline-none focus:border-brand-500'

export default function ConsultorioClient({ token }: { token: string }) {
  const [cargando, setCargando] = useState(true)
  const [tokenInvalido, setTokenInvalido] = useState(false)

  const [profesional, setProfesional] = useState<Profesional | null>(null)
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [moduloId, setModuloId] = useState('')
  const [pendientes, setPendientes] = useState<Turno[]>([])
  const [turnoActual, setTurnoActual] = useState<Turno | null>(null)
  const [accion, setAccion] = useState<Accion>(null)

  const cargarEstado = useCallback(async () => {
    try {
      const data = await pedir<{
        profesional: Profesional
        modulos: Modulo[]
        pendientes: Turno[]
        turnoActual: Turno | null
      }>(`/api/consultorio/${token}`)

      setProfesional(data.profesional)
      setModulos(data.modulos)
      setPendientes(data.pendientes)
      setTurnoActual(data.turnoActual)
      // El consultorio habitual del doctor queda preseleccionado.
      setModuloId((actual) => actual || data.profesional.moduloId || data.modulos[0]?.id || '')
      setTokenInvalido(false)
    } catch {
      setTokenInvalido(true)
    } finally {
      setCargando(false)
    }
  }, [token])

  useEffect(() => {
    cargarEstado()
  }, [cargarEstado])

  async function ejecutar(nombre: Accion, tarea: () => Promise<void>) {
    setAccion(nombre)
    try {
      await tarea()
    } catch (error) {
      toast.error('No se pudo completar la accion', mensajeDeError(error))
    } finally {
      setAccion(null)
    }
  }

  const llamarSiguiente = () =>
    ejecutar('llamar', async () => {
      const { turno } = await pedir<{ turno: Turno }>(`/api/consultorio/${token}/llamar-siguiente`, {
        method: 'POST',
        body: JSON.stringify({ moduloId }),
      })
      setTurnoActual(turno)
      toast.success('Paciente llamado', turno.nombrePaciente ?? turno.codigo)
      await cargarEstado()
    })

  const repetirLlamado = () =>
    ejecutar('repetir', async () => {
      if (!turnoActual) return
      const { turno } = await pedir<{ turno: Turno }>(`/api/consultorio/${token}/${turnoActual.id}/repetir`, {
        method: 'POST',
      })
      setTurnoActual(turno)
      toast.info('Llamado repetido', turno.nombrePaciente ?? turno.codigo)
    })

  const cerrarTurno = (tipo: 'atendido' | 'ausente') =>
    ejecutar(tipo, async () => {
      if (!turnoActual) return
      await pedir(`/api/consultorio/${token}/${turnoActual.id}/${tipo}`, { method: 'POST' })
      toast[tipo === 'atendido' ? 'success' : 'warning'](
        tipo === 'atendido' ? 'Atencion finalizada' : 'Paciente ausente',
        turnoActual.nombrePaciente ?? turnoActual.codigo,
      )
      setTurnoActual(null)
      await cargarEstado()
    })

  if (cargando) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 px-6">
        <p className="text-sm font-bold text-slate-500">Cargando tu consultorio...</p>
      </main>
    )
  }

  if (tokenInvalido || !profesional) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 px-6 text-center">
        <div className="max-w-md space-y-4">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-red-50 text-red-600">
            <WarningCircle size={32} weight="fill" />
          </div>
          <h1 className="text-xl font-black tracking-[-0.02em] text-brand-950">
            Este enlace ya no es valido
          </h1>
          <p className="text-sm leading-6 text-slate-600">
            Puede que haya vencido o que se haya generado uno nuevo. Pide un enlace nuevo a la
            oficina de sistemas del hospital.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex items-center gap-3">
          <Isotipo size={40} />
          <div className="leading-tight">
            <p className="text-lg font-black tracking-[-0.02em] text-brand-950">{profesional.nombre}</p>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{NOMBRE_INSTITUCION}</p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Consultorio</CardTitle>
          </CardHeader>
          <CardContent>
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-slate-700">
                Donde estas atendiendo
              </span>
              <select className={claseCampo} value={moduloId} onChange={(e) => setModuloId(e.target.value)}>
                {modulos.map((m) => (
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
            <CardTitle>Paciente en atencion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {turnoActual ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
                <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Turno</p>
                <p className="mt-1 text-5xl font-black tracking-[-0.03em] text-brand-950">
                  {turnoActual.codigo}
                </p>
                {turnoActual.nombrePaciente ? (
                  <p className="mt-2 text-2xl font-black text-slate-800">{turnoActual.nombrePaciente}</p>
                ) : null}
                <p className="mt-2 text-sm text-slate-600">
                  Llamado {turnoActual.vecesLlamado} {turnoActual.vecesLlamado === 1 ? 'vez' : 'veces'}
                  {turnoActual.horaLlamado ? ` · ${horaCorta(turnoActual.horaLlamado)}` : ''}
                </p>
              </div>
            ) : (
              <EmptyState
                icon={Stethoscope}
                title="Sin paciente en atencion"
                description="Pulsa el boton para llamar al proximo paciente en espera."
              />
            )}

            <Button
              onClick={llamarSiguiente}
              loading={accion === 'llamar'}
              disabled={!moduloId || (!!turnoActual && pendientes.length === 0)}
              className="h-16 w-full text-lg"
            >
              <Megaphone size={22} weight="bold" />
              Siguiente paciente
            </Button>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={repetirLlamado}
                loading={accion === 'repetir'}
                variant="secondary"
                disabled={!turnoActual}
              >
                <ArrowClockwise size={18} weight="bold" />
                Repetir llamado
              </Button>
              <Button
                onClick={() => cerrarTurno('atendido')}
                loading={accion === 'atendido'}
                variant="dark"
                disabled={!turnoActual}
              >
                <CheckCircle size={18} weight="bold" />
                Atendido
              </Button>
              <Button
                onClick={() => cerrarTurno('ausente')}
                loading={accion === 'ausente'}
                variant="danger"
                disabled={!turnoActual}
              >
                <UserMinus size={18} weight="bold" />
                No se presento
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>En espera ({pendientes.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {pendientes.length === 0 ? (
              <p className="text-sm text-slate-500">No tienes pacientes en espera en este momento.</p>
            ) : (
              <ol className="space-y-2">
                {pendientes.map((turno, indice) => (
                  <li
                    key={turno.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-2.5 text-sm"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-black text-slate-600">
                      {indice + 1}
                    </span>
                    <span className="font-black text-brand-950">{turno.codigo}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-700">{turno.nombrePaciente ?? '—'}</span>
                    <span className="shrink-0 text-xs font-bold text-slate-400">
                      {horaCorta(turno.horaCita ?? turno.fechaGeneracion)}
                    </span>
                    {turno.prioridad === 'PRIORITARIO' ? <Badge tone="amber">Prioritario</Badge> : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

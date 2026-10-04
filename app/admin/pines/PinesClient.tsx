'use client'

/**
 * El administrador maneja los PIN de los medicos: los sortea, los vuelve a
 * ver para dictarselos, los cambia, los desactiva o los elimina.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowsClockwise, Eye, EyeSlash, Key, MagnifyingGlass, Trash } from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { Interruptor, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { toast } from '@/components/ui/toast'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import type { Jornada, ModoAccesoProfesional, PinProfesional } from '@/lib/turnos/types'

type Medico = {
  profesionalId: string
  nombre: string
  activo: boolean
  jornada: Jornada
  consultorio: string | null
  pin: PinProfesional | null
}

const COLUMNAS = ['Medico', 'Consultorio', 'PIN', 'Activo', '']

const ETIQUETA_MODO: Record<ModoAccesoProfesional, string> = {
  ENLACE: 'con enlace (el PIN esta apagado)',
  PIN: 'con PIN',
}

const ETIQUETA_JORNADA: Record<Jornada, string> = { MANANA: 'Mañana', TARDE: 'Tarde', COMPLETA: 'Dia completo' }

export default function PinesClient() {
  const [medicos, setMedicos] = useState<Medico[] | null>(null)
  const [modo, setModo] = useState<ModoAccesoProfesional>('PIN')
  const [buscar, setBuscar] = useState('')
  const [visibles, setVisibles] = useState<Set<string>>(new Set())
  const [nuevo, setNuevo] = useState<{ nombre: string; pin: string } | null>(null)
  const [confirmar, setConfirmar] = useState<{ tipo: 'cambiar' | 'eliminar'; medico: Medico } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const datos = await pedir<{ medicos: Medico[]; modo: ModoAccesoProfesional }>('/api/profesionales/pines')
      setMedicos(datos.medicos)
      setModo(datos.modo)
    } catch (error) {
      toast.error('No se pudieron cargar los PIN', mensajeDeError(error))
      setMedicos([])
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const filtrados = useMemo(() => {
    const texto = buscar.trim().toLowerCase()
    return (medicos ?? []).filter((m) => m.activo && (!texto || m.nombre.toLowerCase().includes(texto)))
  }, [medicos, buscar])

  const sinPin = filtrados.filter((m) => !m.pin).length

  async function generar(medico: Medico) {
    setOcupado(medico.profesionalId)
    try {
      const { pin } = await pedir<{ pin: string }>(`/api/profesionales/${medico.profesionalId}/pin`, { method: 'POST' })
      setNuevo({ nombre: medico.nombre, pin })
      await cargar()
    } catch (error) {
      toast.error('No se pudo generar el PIN', mensajeDeError(error))
    } finally {
      setOcupado(null)
    }
  }

  async function cambiarEstado(medico: Medico, activo: boolean) {
    try {
      await pedir(`/api/profesionales/${medico.profesionalId}/pin`, { method: 'PATCH', body: JSON.stringify({ activo }) })
      toast.info(activo ? 'PIN activado' : 'PIN desactivado', medico.nombre)
      await cargar()
    } catch (error) {
      toast.error('No se pudo cambiar el PIN', mensajeDeError(error))
    }
  }

  async function eliminar(medico: Medico) {
    setOcupado(medico.profesionalId)
    try {
      await pedir(`/api/profesionales/${medico.profesionalId}/pin`, { method: 'DELETE' })
      toast.info('PIN eliminado', `${medico.nombre} ya no puede entrar con PIN hasta que le generes uno.`)
      await cargar()
    } catch (error) {
      toast.error('No se pudo eliminar el PIN', mensajeDeError(error))
    } finally {
      setOcupado(null)
    }
  }

  function alternarVer(id: string) {
    setVisibles((actual) => {
      const siguiente = new Set(actual)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  return (
    <div className="space-y-6">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm ${
          modo === 'ENLACE' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'
        }`}
      >
        <p>
          Como entran los medicos ahora: <strong className="font-semibold">{ETIQUETA_MODO[modo]}</strong>.
          {modo === 'PIN' ? (
            <>
              {' '}
              Entran desde el boton <strong className="font-semibold">¿Eres medico?</strong> del inicio de sesion, o en{' '}
              <span className="font-mono">/medico</span>.
            </>
          ) : null}
        </p>
        <Link href="/admin/ajustes" className="font-semibold text-brand-700 hover:underline">
          Cambiarlo en Ajustes
        </Link>
      </div>

      <Card padded={false}>
        <CardHeader>
          <CardTitle>
            Medicos {medicos ? `(${filtrados.length})` : ''}
            {sinPin > 0 ? <span className="ml-2 text-xs font-semibold text-amber-700">{sinPin} sin PIN</span> : null}
          </CardTitle>
          <label className="relative block w-full max-w-xs">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar medico"
              className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm font-medium outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
            />
          </label>
        </CardHeader>
        <CardContent padded={false}>
          {medicos === null ? (
            <TablaSkeleton columnas={COLUMNAS} filas={5} />
          ) : (
            <Tabla columnas={COLUMNAS}>
              {filtrados.map((medico) => {
                const visible = visibles.has(medico.profesionalId)
                return (
                  <tr key={medico.profesionalId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-brand-950">{medico.nombre}</p>
                      <p className="text-xs font-medium text-slate-500">{ETIQUETA_JORNADA[medico.jornada]}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{medico.consultorio ?? '—'}</td>
                    <td className="px-4 py-3">
                      {medico.pin ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="min-w-[5.5rem] font-mono text-base font-semibold tracking-[0.25em] text-brand-950">
                            {visible ? (medico.pin.pin ?? 'ilegible') : '••••••'}
                          </span>
                          <button
                            type="button"
                            onClick={() => alternarVer(medico.profesionalId)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                            aria-label={visible ? `Ocultar el PIN de ${medico.nombre}` : `Ver el PIN de ${medico.nombre}`}
                          >
                            {visible ? <EyeSlash size={17} /> : <Eye size={17} />}
                          </button>
                        </span>
                      ) : (
                        <Badge tone="amber">Sin PIN</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {medico.pin ? (
                        <Interruptor
                          activo={medico.pin.activo}
                          onChange={(valor) => cambiarEstado(medico, valor)}
                          etiqueta={`PIN activo de ${medico.nombre}`}
                        />
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant={medico.pin ? 'secondary' : 'primary'}
                          loading={ocupado === medico.profesionalId}
                          onClick={() => (medico.pin ? setConfirmar({ tipo: 'cambiar', medico }) : void generar(medico))}
                        >
                          {medico.pin ? <ArrowsClockwise size={16} weight="bold" /> : <Key size={16} weight="bold" />}
                          {medico.pin ? 'Cambiar PIN' : 'Generar PIN'}
                        </Button>
                        {medico.pin ? (
                          <Button size="sm" variant="secondary" onClick={() => setConfirmar({ tipo: 'eliminar', medico })} aria-label={`Eliminar el PIN de ${medico.nombre}`}>
                            <Trash size={16} weight="bold" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </Tabla>
          )}
        </CardContent>
      </Card>


      <ConfirmModal
        open={nuevo !== null}
        onClose={() => setNuevo(null)}
        onConfirm={() => setNuevo(null)}
        title="PIN generado"
        description={nuevo ? `Entregaselo a ${nuevo.nombre}. Lo podras volver a ver en esta pantalla.` : undefined}
        confirmLabel="Listo"
      >
        <p className="py-3 text-center font-mono text-4xl font-bold tracking-[0.3em] text-brand-950">{nuevo?.pin}</p>
      </ConfirmModal>

      <ConfirmModal
        open={confirmar !== null}
        onClose={() => setConfirmar(null)}
        onConfirm={() => {
          const pedido = confirmar
          setConfirmar(null)
          if (!pedido) return
          if (pedido.tipo === 'cambiar') void generar(pedido.medico)
          else void eliminar(pedido.medico)
        }}
        title={confirmar?.tipo === 'cambiar' ? 'Cambiar el PIN' : 'Eliminar el PIN'}
        description={
          confirmar?.tipo === 'cambiar'
            ? `Se sortea un PIN nuevo para ${confirmar.medico.nombre} y el actual deja de servir en el acto.`
            : `${confirmar?.medico.nombre ?? ''} no podra entrar con PIN hasta que le generes uno nuevo.`
        }
        confirmLabel={confirmar?.tipo === 'cambiar' ? 'Cambiar PIN' : 'Eliminar PIN'}
        danger={confirmar?.tipo === 'eliminar'}
      />

    </div>
  )
}

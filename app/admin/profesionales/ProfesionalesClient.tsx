'use client'

/**
 * Acceso de doctores por enlace temporal (RF pendiente, confirmado por el
 * hospital: cada profesional pasa sus propios turnos, sin cuenta propia
 * todavia). El administrador genera un enlace con la vigencia que elija,
 * porque hay turnos de manana, tarde y noche que duran distinto.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, IdentificationCard, Link as LinkIcon, Prohibit } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Tabla } from '@/components/admin/Campos'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import type { AccesoProfesional, Modulo, Profesional, Servicio } from '@/lib/turnos/types'

type EstadoAcceso = 'vigente' | 'vencido' | 'revocado' | 'sin_enlace'

const ATAJOS_VIGENCIA = [
  { etiqueta: '6 h (medio turno)', horas: 6, minutos: 0 },
  { etiqueta: '12 h (turno completo)', horas: 12, minutos: 0 },
  { etiqueta: '24 h (un dia)', horas: 24, minutos: 0 },
]

function estadoDelAcceso(acceso: AccesoProfesional | undefined): EstadoAcceso {
  if (!acceso) return 'sin_enlace'
  if (acceso.revocadoEn) return 'revocado'
  if (new Date(acceso.expiraEn).getTime() <= Date.now()) return 'vencido'
  return 'vigente'
}

const etiquetaEstado: Record<EstadoAcceso, string> = {
  vigente: 'Vigente',
  vencido: 'Vencido',
  revocado: 'Revocado',
  sin_enlace: 'Sin enlace',
}

const tonoEstado: Record<EstadoAcceso, 'green' | 'slate' | 'red'> = {
  vigente: 'green',
  vencido: 'slate',
  revocado: 'slate',
  sin_enlace: 'slate',
}

/** Cuenta regresiva legible: "faltan 3 h 20 min", "vencido". */
function tiempoRestante(expiraEn: string): string {
  const ms = new Date(expiraEn).getTime() - Date.now()
  if (ms <= 0) return 'vencido'
  const minutosTotales = Math.round(ms / 60000)
  const horas = Math.floor(minutosTotales / 60)
  const minutos = minutosTotales % 60
  if (horas === 0) return `faltan ${minutos} min`
  if (minutos === 0) return `faltan ${horas} h`
  return `faltan ${horas} h ${minutos} min`
}

function formatoFechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

export default function ProfesionalesClient() {
  const [profesionales, setProfesionales] = useState<Profesional[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [accesos, setAccesos] = useState<AccesoProfesional[]>([])
  const [cargando, setCargando] = useState(true)

  // Modal de generacion.
  const [profesionalActivo, setProfesionalActivo] = useState<Profesional | null>(null)
  const [horas, setHoras] = useState(12)
  const [minutos, setMinutos] = useState(0)
  const [generando, setGenerando] = useState(false)

  // Resultado: el enlace solo se muestra una vez.
  const [enlaceGenerado, setEnlaceGenerado] = useState<{ url: string; expiraEn: string } | null>(null)
  const [copiado, setCopiado] = useState(false)

  // Confirmacion de revocar.
  const [aRevocar, setARevocar] = useState<AccesoProfesional | null>(null)
  const [revocando, setRevocando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const [p, s, m, a] = await Promise.all([
        pedir<{ profesionales: Profesional[] }>('/api/turnos/profesionales'),
        pedir<{ servicios: Servicio[] }>('/api/turnos/servicios'),
        pedir<{ modulos: Modulo[] }>('/api/turnos/modulos'),
        pedir<{ accesos: AccesoProfesional[] }>('/api/profesionales/accesos'),
      ])
      setProfesionales(p.profesionales)
      setServicios(s.servicios)
      setModulos(m.modulos)
      setAccesos(a.accesos)
    } catch (error) {
      toast.error('No se pudieron cargar los profesionales', mensajeDeError(error))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  // El "faltan X min" se queda viejo si no se refresca la vista.
  const [, forzarRefresco] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forzarRefresco((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const nombreServicio = useMemo(() => {
    const mapa = new Map(servicios.map((s) => [s.id, s.nombre]))
    return (id: string) => mapa.get(id) ?? '—'
  }, [servicios])

  const nombreModulo = useMemo(() => {
    const mapa = new Map(modulos.map((m) => [m.id, m.nombre]))
    return (id?: string | null) => (id ? (mapa.get(id) ?? '—') : '—')
  }, [modulos])

  const ultimoAccesoDe = useCallback(
    (profesionalId: string) => accesos.find((a) => a.profesionalId === profesionalId),
    [accesos],
  )

  function abrirGenerar(profesional: Profesional) {
    setProfesionalActivo(profesional)
    setHoras(12)
    setMinutos(0)
    setEnlaceGenerado(null)
    setCopiado(false)
  }

  const duracionMinutos = horas * 60 + minutos
  const duracionValida = duracionMinutos >= 15 && duracionMinutos <= 72 * 60

  // `Date.now()` es impuro: se calcula en un efecto, no durante el render,
  // para no romper la regla de pureza de componentes.
  const [vencimientoPrevisto, setVencimientoPrevisto] = useState<string | null>(null)
  useEffect(() => {
    if (!duracionValida) {
      setVencimientoPrevisto(null)
      return
    }
    setVencimientoPrevisto(new Date(Date.now() + duracionMinutos * 60 * 1000).toISOString())
  }, [duracionMinutos, duracionValida])

  async function generarEnlace() {
    if (!profesionalActivo || !duracionValida) return
    setGenerando(true)
    try {
      const data = await pedir<{ url: string; expiraEn: string }>(
        `/api/profesionales/${profesionalActivo.id}/acceso`,
        { method: 'POST', body: JSON.stringify({ horas, minutos }) },
      )
      setEnlaceGenerado(data)
      console.log('DEBUG_ENLACE', data.url)
      toast.success('Enlace generado', `Para ${profesionalActivo.nombre}. Solo se muestra ahora.`)
      await cargar()
    } catch (error) {
      toast.error('No se pudo generar el enlace', mensajeDeError(error))
    } finally {
      setGenerando(false)
    }
  }

  async function copiarEnlace() {
    if (!enlaceGenerado) return
    try {
      await navigator.clipboard.writeText(enlaceGenerado.url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('No se pudo copiar', 'Selecciona y copia el enlace manualmente.')
    }
  }

  async function confirmarRevocar() {
    if (!aRevocar) return
    setRevocando(true)
    try {
      await pedir(`/api/profesionales/accesos/${aRevocar.id}`, { method: 'DELETE' })
      toast.info('Enlace revocado', 'El doctor ya no podra usarlo.')
      setARevocar(null)
      await cargar()
    } catch (error) {
      toast.error('No se pudo revocar', mensajeDeError(error))
    } finally {
      setRevocando(false)
    }
  }

  return (
    <>
      <Card padded={false}>
        <CardHeader>
          <CardTitle>Profesionales ({profesionales.length})</CardTitle>
        </CardHeader>
        <CardContent padded={false}>
          {cargando ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Cargando profesionales...</p>
          ) : profesionales.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={IdentificationCard}
                title="Sin profesionales"
                description="Todavia no hay profesionales registrados."
              />
            </div>
          ) : (
            <Tabla columnas={['Profesional', 'Servicio', 'Consultorio', 'Enlace', '']}>
              {profesionales.map((profesional) => {
                const acceso = ultimoAccesoDe(profesional.id)
                const estado = estadoDelAcceso(acceso)
                return (
                  <tr key={profesional.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-black text-brand-950">{profesional.nombre}</td>
                    <td className="px-4 py-3 text-slate-600">{nombreServicio(profesional.servicioId)}</td>
                    <td className="px-4 py-3 text-slate-600">{nombreModulo(profesional.moduloId)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <Badge tone={tonoEstado[estado]}>{etiquetaEstado[estado]}</Badge>
                        {acceso && estado === 'vigente' ? (
                          <span className="text-xs font-semibold text-slate-400">
                            {tiempoRestante(acceso.expiraEn)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => abrirGenerar(profesional)}>
                          <LinkIcon size={16} weight="bold" />
                          Generar enlace
                        </Button>
                        {estado === 'vigente' && acceso ? (
                          <Button size="sm" variant="danger" onClick={() => setARevocar(acceso)}>
                            <Prohibit size={16} weight="bold" />
                            Revocar
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

      <Modal
        open={!!profesionalActivo}
        onClose={() => setProfesionalActivo(null)}
        title={enlaceGenerado ? 'Enlace generado' : `Generar enlace para ${profesionalActivo?.nombre ?? ''}`}
        description={
          enlaceGenerado
            ? 'Copialo y enviaselo al doctor ahora: por seguridad, no se puede volver a mostrar.'
            : 'Elige cuanto debe durar el enlace. Se pensó para que coincida con la duracion del turno del doctor.'
        }
      >
        {enlaceGenerado ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                readOnly
                value={enlaceGenerado.url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 truncate bg-transparent text-sm font-semibold text-brand-950 outline-none"
              />
              <Button size="sm" variant="secondary" onClick={copiarEnlace}>
                {copiado ? <Check size={16} weight="bold" /> : <Copy size={16} weight="bold" />}
                {copiado ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <p className="text-sm text-slate-600">
              Vence el <strong>{formatoFechaHora(enlaceGenerado.expiraEn)}</strong>.
            </p>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setProfesionalActivo(null)}>
                Listo
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Campo etiqueta="Horas">
                <Entrada
                  type="number"
                  min={0}
                  max={72}
                  value={horas}
                  onChange={(e) => setHoras(Math.max(0, Number(e.target.value) || 0))}
                />
              </Campo>
              <Campo etiqueta="Minutos">
                <Entrada
                  type="number"
                  min={0}
                  max={59}
                  value={minutos}
                  onChange={(e) => setMinutos(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                />
              </Campo>
            </div>

            <div className="flex flex-wrap gap-2">
              {ATAJOS_VIGENCIA.map((atajo) => (
                <Button
                  key={atajo.etiqueta}
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setHoras(atajo.horas)
                    setMinutos(atajo.minutos)
                  }}
                >
                  {atajo.etiqueta}
                </Button>
              ))}
            </div>

            {duracionValida && vencimientoPrevisto ? (
              <p className="text-sm text-slate-600">
                Vence el <strong>{formatoFechaHora(vencimientoPrevisto)}</strong>.
              </p>
            ) : (
              <p className="text-sm font-semibold text-red-600">
                La vigencia debe ser entre 15 minutos y 72 horas.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setProfesionalActivo(null)}>
                Cancelar
              </Button>
              <Button onClick={generarEnlace} loading={generando} disabled={!duracionValida}>
                Generar enlace
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!aRevocar}
        onClose={() => setARevocar(null)}
        onConfirm={confirmarRevocar}
        loading={revocando}
        title="Revocar este enlace"
        description="El doctor ya no podra entrar con el. Si sigue con su turno, genera uno nuevo."
        confirmLabel="Revocar"
        danger
      />
    </>
  )
}

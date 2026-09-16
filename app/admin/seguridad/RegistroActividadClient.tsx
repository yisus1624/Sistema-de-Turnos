'use client'

/**
 * Registro de actividades importantes (requerimiento seccion 17).
 *
 * Lo que se apunta aqui es lo que el propio dato NO conserva. El recorrido de
 * un turno (quien lo llamo, a que hora, cuantas veces, quien lo cerro) vive en
 * el turno mismo y no se repite en esta lista: llenarla con un apunte por
 * llamado solo desplazaria lo que si hay que poder revisar despues, que son los
 * intentos de entrada fallidos y las decisiones sobre cuentas y citas.
 */

import { useCallback, useEffect, useState } from 'react'
import { Broom, ShieldCheck } from '@phosphor-icons/react/dist/ssr'
import PurgaDatosModal from '@/components/seguridad/PurgaDatosModal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { Campo, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { toast } from '@/components/ui/toast'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import type { EventoSeguridad } from '@/lib/seguridad/registro'

const COLUMNAS = ['Cuando', 'Que paso', 'Quien', 'Sobre', 'Detalle']

/** Nombre legible de cada tipo de evento. Uno desconocido se muestra tal cual. */
const ETIQUETAS: Record<string, string> = {
  INICIO_SESION: 'Inicio de sesion',
  USUARIO_CREADO: 'Cuenta creada',
  USUARIO_ACTUALIZADO: 'Cuenta modificada',
  ACCESO_PROFESIONAL: 'Acceso del doctor',
  ACCESO_PROFESIONAL_GENERADO: 'Enlace de consultorio generado',
  ACCESO_PROFESIONAL_REVOCADO: 'Enlace de consultorio revocado',
  CITA_CREADA: 'Cita agendada',
  CITA_CANCELADA: 'Cita cancelada',
  CITA_REPROGRAMADA: 'Cita reprogramada',
  LLEGADA_REGISTRADA: 'Llegada registrada',
  TURNO_ATENDIDO: 'Turno cerrado como atendido',
  TURNO_AUSENTE: 'Paciente dado por ausente',
  CONFIGURACION_ACTUALIZADA: 'Configuracion del sistema',
  SIMULACION_REINICIO_DEL_DIA: 'Reinicio del dia (simulacion)',
  // Estos dos se guardan en minusculas porque nacieron despues. El nombre
  // guardado no se toca —cambiarlo dejaria ilegibles los registros que ya
  // estan— pero si su etiqueta, que es lo que se lee en la pantalla.
  'citas.importadas': 'Agenda del hospital cargada',
  'citas.datos.purgados': 'Datos de pacientes anonimizados',
  'profesionales.jornadas.recalculadas': 'Jornadas de los doctores recalculadas',
}

function cuando(iso: string) {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

function detalleCorto(detalle?: Record<string, unknown>) {
  if (!detalle) return '—'
  const partes = Object.entries(detalle)
    .filter(([, valor]) => valor !== null && valor !== undefined && valor !== '')
    .map(([clave, valor]) => `${clave}: ${Array.isArray(valor) ? valor.join(', ') : String(valor)}`)
  return partes.length > 0 ? partes.join(' · ') : '—'
}

export default function RegistroActividadClient({ esAdministrador }: { esAdministrador: boolean }) {
  const [eventos, setEventos] = useState<EventoSeguridad[]>([])
  const [cargando, setCargando] = useState(true)
  const [tipo, setTipo] = useState('')
  const [soloFallidos, setSoloFallidos] = useState(false)
  const [purgaAbierta, setPurgaAbierta] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const { eventos: lista } = await pedir<{ eventos: EventoSeguridad[] }>(
        '/api/seguridad/eventos?limite=500',
      )
      setEventos(lista)
    } catch (error) {
      toast.error('No se pudo cargar el registro', mensajeDeError(error))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const tipos = [...new Set(eventos.map((e) => e.tipo))].sort()
  const visibles = eventos.filter((evento) => {
    if (tipo && evento.tipo !== tipo) return false
    if (soloFallidos && evento.exito) return false
    return true
  })

  return (
    <>
    <Card padded={false}>
      <CardHeader>
        <CardTitle>Actividad reciente ({visibles.length})</CardTitle>
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Tipo" className="w-56">
            <Seleccion value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETAS[t] ?? t}
                </option>
              ))}
            </Seleccion>
          </Campo>
          <Button
            variant={soloFallidos ? 'danger' : 'secondary'}
            size="sm"
            onClick={() => setSoloFallidos((v) => !v)}
          >
            {soloFallidos ? 'Viendo solo fallidos' : 'Ver solo fallidos'}
          </Button>
          <Button variant="secondary" size="sm" onClick={cargar}>
            Actualizar
          </Button>
          {/*
            Aqui y no junto a la carga de la agenda: es lo unico irreversible
            del sistema y no puede ser un efecto secundario del trabajo diario.
          */}
          {esAdministrador ? (
            <Button variant="secondary" size="sm" onClick={() => setPurgaAbierta(true)}>
              <Broom size={16} weight="bold" />
              Anonimizar datos viejos
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent padded={false}>
        {cargando ? (
          <TablaSkeleton columnas={COLUMNAS} />
        ) : visibles.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={ShieldCheck}
              title="Sin actividad registrada"
              description="Aqui van a aparecer los inicios de sesion, los cambios de cuentas y el recorrido de las citas y los turnos."
            />
          </div>
        ) : (
          <>
            <p className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs leading-5 text-slate-500">
              El registro vive en memoria mientras el hospital define donde guardarlo: se pierde al
              reiniciar el servidor. Los llamados de turno no se apuntan aqui porque ese recorrido queda
              entero en el turno.
            </p>
            <Tabla columnas={COLUMNAS}>
              {visibles.map((evento, i) => (
                <tr key={`${evento.fecha}-${i}`} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-slate-600">
                    {cuando(evento.fecha)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={evento.exito ? 'green' : 'red'}>{evento.exito ? 'OK' : 'Fallo'}</Badge>
                      <span className="font-bold text-brand-950">{ETIQUETAS[evento.tipo] ?? evento.tipo}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {evento.usuarioId ?? evento.ip ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{evento.identificador ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{detalleCorto(evento.detalle)}</td>
                </tr>
              ))}
            </Tabla>
          </>
        )}
      </CardContent>
    </Card>

    <PurgaDatosModal
      abierto={purgaAbierta}
      onCerrar={() => {
        setPurgaAbierta(false)
        cargar()
      }}
    />
    </>
  )
}

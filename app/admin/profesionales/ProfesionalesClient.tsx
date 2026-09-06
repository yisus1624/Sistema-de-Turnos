'use client'

/**
 * Catalogo de profesionales (doctores).
 *
 * Mientras la API del hospital no exista, los doctores se dan de alta a mano
 * aqui. Dos reglas del dominio que esta pantalla hace cumplir:
 *
 * 1. Un doctor no se borra, se DESACTIVA: su nombre quedo escrito en los
 *    turnos que ya llamo y borrarlo dejaria ese rastro huerfano.
 * 2. Solo existe en servicios que atienden POR CITA. En los de ventanilla la
 *    fila es compartida y la toma quien este libre, asi que un doctor asignado
 *    ahi no tendria pacientes propios a quien llamar.
 *
 * El enlace con el que cada doctor entra a su consultorio NO se maneja aqui,
 * sino en "Enlaces de consultorio". Van separados a proposito: repartir
 * enlaces es trabajo del dia a dia y se le puede encargar al operador del
 * mostrador, mientras que tocar el catalogo (la jornada, sobre todo) le mueve
 * la agenda a todo el hospital.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { IdentificationCard, Plus } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Interruptor, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import type { Jornada, Modulo, Profesional, Servicio } from '@/lib/turnos/types'

const COLUMNAS = ['Profesional', 'Servicio', 'Jornada', 'Consultorio', 'Estado']

type FormularioDoctor = {
  nombre: string
  servicioId: string
  jornada: Jornada
  moduloId: string
  activo: boolean
}

const DOCTOR_VACIO: FormularioDoctor = {
  nombre: '',
  servicioId: '',
  jornada: 'MANANA',
  moduloId: '',
  activo: true,
}

/**
 * La jornada decide a que horas se le puede agendar al doctor. Las horas
 * concretas de cada una son las mismas para todo el hospital y se configuran
 * en "Pantalla y audio"; aqui solo se elige en cual trabaja.
 */
const etiquetaJornada: Record<Jornada, string> = {
  MANANA: 'Mañana',
  TARDE: 'Tarde',
  COMPLETA: 'Dia completo',
}

const tonoJornada: Record<Jornada, 'amber' | 'blue' | 'green'> = {
  MANANA: 'amber',
  TARDE: 'blue',
  COMPLETA: 'green',
}

export default function ProfesionalesClient() {
  const [profesionales, setProfesionales] = useState<Profesional[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [cargando, setCargando] = useState(true)

  const [abierto, setAbierto] = useState(false)
  const [editando, setEditando] = useState<Profesional | null>(null)
  const [formulario, setFormulario] = useState<FormularioDoctor>(DOCTOR_VACIO)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      // `todos=1`: la administracion tambien ve a los inactivos, que es la
      // unica forma de volver a activarlos.
      const [p, s, m] = await Promise.all([
        pedir<{ profesionales: Profesional[] }>('/api/turnos/profesionales?todos=1'),
        pedir<{ servicios: Servicio[] }>('/api/turnos/servicios?todos=1'),
        pedir<{ modulos: Modulo[] }>('/api/turnos/modulos?todos=1'),
      ])
      setProfesionales(p.profesionales)
      setServicios(s.servicios)
      setModulos(m.modulos)
    } catch (error) {
      toast.error('No se pudieron cargar los profesionales', mensajeDeError(error))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const nombreServicio = useMemo(() => {
    const mapa = new Map(servicios.map((s) => [s.id, s.nombre]))
    return (id: string) => mapa.get(id) ?? '—'
  }, [servicios])

  const nombreModulo = useMemo(() => {
    const mapa = new Map(modulos.map((m) => [m.id, m.nombre]))
    return (id?: string | null) => (id ? (mapa.get(id) ?? '—') : '—')
  }, [modulos])

  /**
   * Servicios a los que se puede asignar un doctor: solo los que atienden por
   * cita. Los de ventanilla tienen fila compartida y no llevan profesional; el
   * servidor tambien lo rechaza, pero ofrecerlos aqui seria mandar al
   * administrador a un error evitable.
   */
  // El catalogo se pide con los inactivos (para poder resolver el nombre de un
  // servicio apagado al lado de un doctor que sigue existiendo), pero ASIGNAR
  // solo se puede a uno activo: mandar un doctor a un servicio apagado lo deja
  // sin fila y sin pantalla.
  const serviciosConCita = useMemo(
    () => servicios.filter((s) => s.activo && s.modoFila === 'POR_PROFESIONAL'),
    [servicios],
  )

  /**
   * Consultorios del servicio elegido, mas los que no estan asignados a
   * ninguno.
   *
   * Se muestran solo los ACTIVOS, salvo el que el doctor ya tenga puesto: si su
   * consultorio se desactivo, dejarlo fuera de la lista se lo borraba en
   * silencio la proxima vez que alguien le editara el nombre.
   */
  const modulosDelServicio = useMemo(
    () =>
      modulos.filter(
        (m) =>
          (!m.servicioId || m.servicioId === formulario.servicioId) &&
          (m.activo || m.id === formulario.moduloId),
      ),
    [modulos, formulario.servicioId, formulario.moduloId],
  )

  function abrirNuevo() {
    setEditando(null)
    setFormulario({ ...DOCTOR_VACIO, servicioId: serviciosConCita[0]?.id ?? '' })
    setAbierto(true)
  }

  function abrirEdicion(profesional: Profesional) {
    setEditando(profesional)
    setFormulario({
      nombre: profesional.nombre,
      servicioId: profesional.servicioId,
      jornada: profesional.jornada,
      moduloId: profesional.moduloId ?? '',
      activo: profesional.activo,
    })
    setAbierto(true)
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    setGuardando(true)

    const cuerpo = {
      nombre: formulario.nombre,
      servicioId: formulario.servicioId,
      jornada: formulario.jornada,
      moduloId: formulario.moduloId || null,
    }

    try {
      if (editando) {
        await pedir(`/api/turnos/profesionales/${editando.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...cuerpo, activo: formulario.activo }),
        })
        toast.success('Profesional actualizado', formulario.nombre)
      } else {
        await pedir('/api/turnos/profesionales', { method: 'POST', body: JSON.stringify(cuerpo) })
        toast.success('Profesional creado', `Ya se le pueden agendar citas a ${formulario.nombre}.`)
      }
      setAbierto(false)
      await cargar()
    } catch (error) {
      toast.error('No se pudo guardar', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <Card padded={false}>
        <CardHeader>
          <CardTitle>Profesionales ({profesionales.length})</CardTitle>
          <Button size="sm" onClick={abrirNuevo} disabled={serviciosConCita.length === 0}>
            <Plus size={17} weight="bold" />
            Nuevo doctor
          </Button>
        </CardHeader>
        <CardContent padded={false}>
          {cargando ? (
            <TablaSkeleton columnas={COLUMNAS} />
          ) : profesionales.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={IdentificationCard}
                title="Sin profesionales"
                description="Crea el primer doctor para poder agendarle citas."
              />
            </div>
          ) : (
            <Tabla columnas={COLUMNAS}>
              {profesionales.map((profesional) => (
                <tr
                  key={profesional.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => abrirEdicion(profesional)}
                >
                  <td className="px-4 py-3 font-black text-brand-950">{profesional.nombre}</td>
                  <td className="px-4 py-3 text-slate-600">{nombreServicio(profesional.servicioId)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={tonoJornada[profesional.jornada]}>
                      {etiquetaJornada[profesional.jornada]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{nombreModulo(profesional.moduloId)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={profesional.activo ? 'green' : 'slate'}>
                      {profesional.activo ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-sm leading-6 text-slate-500">
        El enlace con el que cada doctor entra a su consultorio se genera en{' '}
        <strong className="font-black text-slate-600">Enlaces de consultorio</strong>.
      </p>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={editando ? 'Editar profesional' : 'Nuevo doctor'}
        description="Los doctores atienden por cita: el servicio decide en que fila entran sus pacientes."
      >
        <form onSubmit={guardar} className="space-y-4">
          <Campo etiqueta="Nombre">
            <Entrada
              value={formulario.nombre}
              onChange={(e) => setFormulario((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Dra. Maria Gomez"
              required
              minLength={3}
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Servicio">
              <Seleccion
                value={formulario.servicioId}
                onChange={(e) =>
                  // Al cambiar de servicio, el consultorio anterior puede no
                  // pertenecerle: se limpia en vez de dejar una pareja invalida.
                  setFormulario((f) => ({ ...f, servicioId: e.target.value, moduloId: '' }))
                }
                required
              >
                {serviciosConCita.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <Campo etiqueta="Jornada" ayuda="En que parte del dia atiende. Decide a que horas se le puede agendar.">
              <Seleccion
                value={formulario.jornada}
                onChange={(e) => setFormulario((f) => ({ ...f, jornada: e.target.value as Jornada }))}
                required
              >
                <option value="MANANA">{etiquetaJornada.MANANA}</option>
                <option value="TARDE">{etiquetaJornada.TARDE}</option>
                <option value="COMPLETA">{etiquetaJornada.COMPLETA}</option>
              </Seleccion>
            </Campo>
          </div>

          <Campo etiqueta="Consultorio" ayuda="Opcional. El doctor puede cambiarlo al iniciar su jornada.">
            <Seleccion
              value={formulario.moduloId}
              onChange={(e) => setFormulario((f) => ({ ...f, moduloId: e.target.value }))}
            >
              <option value="">Sin asignar</option>
              {modulosDelServicio.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          {editando ? (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-3.5">
              <div>
                <p className="text-sm font-black text-slate-800">Activo</p>
                <p className="text-xs text-slate-500">
                  Al desactivarlo deja de aparecer para agendarle citas. No se borra: su nombre sigue en los
                  turnos que ya llamo.
                </p>
              </div>
              <Interruptor
                activo={formulario.activo}
                onChange={(valor) => setFormulario((f) => ({ ...f, activo: valor }))}
                etiqueta={`Activar ${formulario.nombre}`}
              />
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={guardando}>
              {editando ? 'Guardar cambios' : 'Crear doctor'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

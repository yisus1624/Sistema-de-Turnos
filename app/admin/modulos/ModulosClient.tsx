'use client'

/**
 * Administracion de modulos: consultorios y ventanillas (seccion 15).
 *
 * Un modulo con servicio es un consultorio de ese servicio; un modulo sin
 * servicio es una ventanilla generica que sirve para cualquier fila compartida.
 */

import { useCallback, useEffect, useState } from 'react'
import { Gear, Plus } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Interruptor, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { CeldaActividad, SelectorDeDia, useActividadDelDia } from '@/components/admin/ActividadDelDia'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import type { Modulo, Servicio } from '@/lib/turnos/types'

const COLUMNAS = ['Modulo', 'Servicio', 'Ese dia', 'Estado']

type Formulario = { nombre: string; servicioId: string }

const FORMULARIO_VACIO: Formulario = { nombre: '', servicioId: '' }

export default function ModulosClient() {
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const [editando, setEditando] = useState<Modulo | null>(null)
  const [formulario, setFormulario] = useState<Formulario>(FORMULARIO_VACIO)
  const [guardando, setGuardando] = useState(false)
  // Que consultorio esta a punto de apagarse, esperando confirmacion.
  const [aDesactivar, setADesactivar] = useState<Modulo | null>(null)
  const [desactivando, setDesactivando] = useState(false)

  /**
   * El dia que se esta mirando, y lo que se uso ese dia.
   *
   * El catalogo lo va llenando la carga del reporte del hospital y ahi todo
   * entra activo y ahi se queda, asi que "Activo" acaba queriendo decir "existe
   * en el hospital". La pregunta de todos los dias es otra —"que consultorios
   * trabajan hoy"— y sin esto la tabla no la podia contestar.
   */
  const {
    fecha,
    setFecha,
    actividad,
    cargando: cargandoActividad,
    error: errorActividad,
    esFutura,
  } = useActividadDelDia('porModulo')

  const cargar = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([
        pedir<{ modulos: Modulo[] }>('/api/turnos/modulos?todos=1'),
        pedir<{ servicios: Servicio[] }>('/api/turnos/servicios?todos=1'),
      ])
      setModulos(m.modulos)
      setServicios(s.servicios)
    } catch (error) {
      toast.error('No se pudieron cargar los modulos', mensajeDeError(error))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const nombreServicio = (id?: string | null) =>
    id ? (servicios.find((s) => s.id === id)?.nombre ?? 'Servicio eliminado') : 'Ventanilla general'

  function abrirNuevo() {
    setEditando(null)
    setFormulario(FORMULARIO_VACIO)
    setAbierto(true)
  }

  function abrirEdicion(modulo: Modulo) {
    setEditando(modulo)
    setFormulario({ nombre: modulo.nombre, servicioId: modulo.servicioId ?? '' })
    setAbierto(true)
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    setGuardando(true)

    const cuerpo = { nombre: formulario.nombre, servicioId: formulario.servicioId || null }

    try {
      if (editando) {
        await pedir(`/api/turnos/modulos/${editando.id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) })
        toast.success('Modulo actualizado', formulario.nombre)
      } else {
        await pedir('/api/turnos/modulos', { method: 'POST', body: JSON.stringify({ ...cuerpo, activo: true }) })
        toast.success('Modulo creado', formulario.nombre)
      }
      setAbierto(false)
      await cargar()
    } catch (error) {
      toast.error('No se pudo guardar', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  /**
   * Se avisa ANTES de apagarlo, no despues. Desactivar un consultorio lo borra
   * del televisor de la sala de espera, que es por donde el paciente sabe a que
   * puerta entrar; el servidor ademas lo rechaza si hay un turno siendo
   * atendido ahi, pero el resto de las veces el efecto es silencioso y el
   * interruptor no lo deja ver.
   *
   * Con el `ConfirmModal` del sistema, no con el cuadro del navegador: era la
   * unica confirmacion del sistema que se salia del patron, y la del navegador
   * ni se puede leer con el estilo del resto ni respeta el foco de la pantalla.
   */
  async function cambiarEstado(modulo: Modulo, activo: boolean) {
    if (!activo) {
      setADesactivar(modulo)
      return
    }

    await aplicarEstado(modulo, true)
  }

  async function aplicarEstado(modulo: Modulo, activo: boolean) {
    try {
      await pedir(`/api/turnos/modulos/${modulo.id}`, { method: 'PATCH', body: JSON.stringify({ activo }) })
      setModulos((previos) => previos.map((m) => (m.id === modulo.id ? { ...m, activo } : m)))
      toast.info(activo ? 'Modulo activado' : 'Modulo desactivado', modulo.nombre)
    } catch (error) {
      toast.error('No se pudo cambiar el estado', mensajeDeError(error))
    }
  }

  async function confirmarDesactivar() {
    if (!aDesactivar) return

    setDesactivando(true)
    try {
      await aplicarEstado(aDesactivar, false)
      setADesactivar(null)
    } finally {
      setDesactivando(false)
    }
  }

  return (
    <>
      <Card className="mb-5">
        <SelectorDeDia
          fecha={fecha}
          onFecha={setFecha}
          ayuda="Un consultorio puede estar activo en el catalogo y no usarse ese dia: 'Ese dia' sale de las citas, no del interruptor."
        />
      </Card>

      <Card padded={false}>
        <CardHeader>
          <CardTitle>Consultorios y ventanillas ({modulos.length})</CardTitle>
          <Button size="sm" onClick={abrirNuevo}>
            <Plus size={17} weight="bold" />
            Nuevo modulo
          </Button>
        </CardHeader>
        <CardContent padded={false}>
          {cargando ? (
            <TablaSkeleton columnas={COLUMNAS} />
          ) : modulos.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Gear}
                title="Sin modulos"
                description="Crea los consultorios y ventanillas donde se atiende a los pacientes."
              />
            </div>
          ) : (
            <Tabla columnas={COLUMNAS}>
              {modulos.map((modulo) => (
                <tr
                  key={modulo.id}
                  onClick={() => abrirEdicion(modulo)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-semibold text-brand-950">{modulo.nombre}</td>
                  <td className="px-4 py-3 text-slate-600">{nombreServicio(modulo.servicioId)}</td>
                  <td className="px-4 py-3">
                    <CeldaActividad
                      actividad={actividad[modulo.id]}
                      cargando={cargandoActividad}
                      error={errorActividad}
                      esFutura={esFutura}
                    />
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-3">
                      <Interruptor
                        activo={modulo.activo}
                        onChange={(valor) => cambiarEstado(modulo, valor)}
                        etiqueta={`Activar ${modulo.nombre}`}
                      />
                      <Badge tone={modulo.activo ? 'green' : 'slate'}>
                        {modulo.activo ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </div>
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
        </CardContent>
      </Card>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={editando ? 'Editar modulo' : 'Nuevo modulo'}
        description="Es el lugar al que se dirige el paciente: un consultorio o una ventanilla."
      >
        <form onSubmit={guardar} className="space-y-4">
          <Campo etiqueta="Nombre">
            <Entrada
              value={formulario.nombre}
              onChange={(e) => setFormulario((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Consultorio 5"
              required
              minLength={3}
            />
          </Campo>

          <Campo
            etiqueta="Servicio"
            ayuda="Deja 'Ventanilla general' si sirve para cualquier fila por orden de llegada."
          >
            <Seleccion
              value={formulario.servicioId}
              onChange={(e) => setFormulario((f) => ({ ...f, servicioId: e.target.value }))}
            >
              <option value="">Ventanilla general</option>
              {/*
                Solo servicios ACTIVOS: el catalogo se pide completo para poder
                mostrar el nombre de un servicio apagado en la tabla, pero
                asignarle un consultorio nuevo no tendria sentido. Si el modulo
                que se esta editando ya cuelga de uno apagado, se mantiene en la
                lista para no cambiarselo sin querer al guardar.
              */}
              {servicios
                .filter((servicio) => servicio.activo || servicio.id === formulario.servicioId)
                .map((servicio) => (
                  <option key={servicio.id} value={servicio.id}>
                    {servicio.nombre}
                    {servicio.activo ? '' : ' (inactivo)'}
                  </option>
                ))}
            </Seleccion>
          </Campo>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={guardando}>
              {editando ? 'Guardar cambios' : 'Crear modulo'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!aDesactivar}
        onClose={() => setADesactivar(null)}
        onConfirm={confirmarDesactivar}
        loading={desactivando}
        title={`Desactivar ${aDesactivar?.nombre ?? ''}`}
        description="Deja de aparecer en la pantalla de la sala de espera y no se le podran asignar turnos. El historico no se pierde y se puede volver a activar cuando haga falta."
        confirmLabel="Desactivar"
        danger
      />
    </>
  )
}

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
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Interruptor, Seleccion, Tabla } from '@/components/admin/Campos'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import type { Modulo, Servicio } from '@/lib/turnos/types'

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

  const cargar = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([
        pedir<{ modulos: Modulo[] }>('/api/turnos/modulos'),
        pedir<{ servicios: Servicio[] }>('/api/turnos/servicios'),
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

  async function cambiarEstado(modulo: Modulo, activo: boolean) {
    try {
      await pedir(`/api/turnos/modulos/${modulo.id}`, { method: 'PATCH', body: JSON.stringify({ activo }) })
      setModulos((previos) => previos.map((m) => (m.id === modulo.id ? { ...m, activo } : m)))
      toast.info(activo ? 'Modulo activado' : 'Modulo desactivado', modulo.nombre)
    } catch (error) {
      toast.error('No se pudo cambiar el estado', mensajeDeError(error))
    }
  }

  return (
    <>
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
            <p className="px-5 py-10 text-center text-sm text-slate-500">Cargando modulos...</p>
          ) : modulos.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Gear}
                title="Sin modulos"
                description="Crea los consultorios y ventanillas donde se atiende a los pacientes."
              />
            </div>
          ) : (
            <Tabla columnas={['Modulo', 'Servicio', 'Estado', '']}>
              {modulos.map((modulo) => (
                <tr key={modulo.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-black text-brand-950">{modulo.nombre}</td>
                  <td className="px-4 py-3 text-slate-600">{nombreServicio(modulo.servicioId)}</td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="secondary" onClick={() => abrirEdicion(modulo)}>
                      Editar
                    </Button>
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
              {servicios.map((servicio) => (
                <option key={servicio.id} value={servicio.id}>
                  {servicio.nombre}
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
    </>
  )
}

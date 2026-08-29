'use client'

/**
 * Administracion de servicios (requerimiento secciones 15 y RF-002).
 *
 * El prefijo es lo que forma el codigo del turno (A-025), asi que es unico por
 * servicio y solo admite letras. El modo de fila decide si el servicio atiende
 * por orden de llegada o por cita asignada a un profesional.
 */

import { useCallback, useEffect, useState } from 'react'
import { Plus, Stack } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Interruptor, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import type { ModoFila, Servicio } from '@/lib/turnos/types'

const COLUMNAS = ['Servicio', 'Prefijo', 'Modo de fila', 'Estado']

type Formulario = {
  nombre: string
  prefijo: string
  modoFila: ModoFila
}

const FORMULARIO_VACIO: Formulario = { nombre: '', prefijo: '', modoFila: 'COMPARTIDA' }

const etiquetaModo: Record<ModoFila, string> = {
  COMPARTIDA: 'Ventanilla (orden de llegada)',
  POR_PROFESIONAL: 'Consultorio (por cita)',
}

export default function ServiciosClient() {
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const [editando, setEditando] = useState<Servicio | null>(null)
  const [formulario, setFormulario] = useState<Formulario>(FORMULARIO_VACIO)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const { servicios: lista } = await pedir<{ servicios: Servicio[] }>('/api/turnos/servicios')
      setServicios(lista)
    } catch (error) {
      toast.error('No se pudieron cargar los servicios', mensajeDeError(error))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  function abrirNuevo() {
    setEditando(null)
    setFormulario(FORMULARIO_VACIO)
    setAbierto(true)
  }

  function abrirEdicion(servicio: Servicio) {
    setEditando(servicio)
    setFormulario({ nombre: servicio.nombre, prefijo: servicio.prefijo, modoFila: servicio.modoFila })
    setAbierto(true)
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    try {
      if (editando) {
        await pedir(`/api/turnos/servicios/${editando.id}`, {
          method: 'PATCH',
          body: JSON.stringify(formulario),
        })
        toast.success('Servicio actualizado', formulario.nombre)
      } else {
        await pedir('/api/turnos/servicios', {
          method: 'POST',
          body: JSON.stringify({ ...formulario, activo: true }),
        })
        toast.success('Servicio creado', formulario.nombre)
      }
      setAbierto(false)
      await cargar()
    } catch (error) {
      toast.error('No se pudo guardar', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  async function cambiarEstado(servicio: Servicio, activo: boolean) {
    try {
      await pedir(`/api/turnos/servicios/${servicio.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo }),
      })
      setServicios((previos) => previos.map((s) => (s.id === servicio.id ? { ...s, activo } : s)))
      toast.info(activo ? 'Servicio activado' : 'Servicio desactivado', servicio.nombre)
    } catch (error) {
      toast.error('No se pudo cambiar el estado', mensajeDeError(error))
    }
  }

  return (
    <>
      <Card padded={false}>
        <CardHeader>
          <CardTitle>Servicios de atencion ({servicios.length})</CardTitle>
          <Button size="sm" onClick={abrirNuevo}>
            <Plus size={17} weight="bold" />
            Nuevo servicio
          </Button>
        </CardHeader>
        <CardContent padded={false}>
          {cargando ? (
            <TablaSkeleton columnas={COLUMNAS} />
          ) : servicios.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Stack}
                title="Sin servicios"
                description="Crea el primer servicio de atencion para empezar a generar turnos."
              />
            </div>
          ) : (
            <Tabla columnas={COLUMNAS}>
              {servicios.map((servicio) => (
                <tr
                  key={servicio.id}
                  onClick={() => abrirEdicion(servicio)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-black text-brand-950">{servicio.nombre}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-black text-slate-700">
                      {servicio.prefijo}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{etiquetaModo[servicio.modoFila]}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-3">
                      <Interruptor
                        activo={servicio.activo}
                        onChange={(valor) => cambiarEstado(servicio, valor)}
                        etiqueta={`Activar ${servicio.nombre}`}
                      />
                      <Badge tone={servicio.activo ? 'green' : 'slate'}>
                        {servicio.activo ? 'Activo' : 'Inactivo'}
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
        title={editando ? 'Editar servicio' : 'Nuevo servicio'}
        description="El prefijo forma el codigo del turno, por ejemplo A-025 para Admisiones."
      >
        <form onSubmit={guardar} className="space-y-4">
          <Campo etiqueta="Nombre">
            <Entrada
              value={formulario.nombre}
              onChange={(e) => setFormulario((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Odontologia"
              required
              minLength={3}
            />
          </Campo>

          <Campo etiqueta="Prefijo" ayuda="Una a tres letras. Debe ser distinto al de los demas servicios.">
            <Entrada
              value={formulario.prefijo}
              onChange={(e) => setFormulario((f) => ({ ...f, prefijo: e.target.value.toUpperCase() }))}
              placeholder="O"
              maxLength={3}
              required
            />
          </Campo>

          <Campo
            etiqueta="Modo de fila"
            ayuda="Ventanilla: cualquiera atiende el siguiente. Consultorio: cada profesional ve solo sus pacientes con cita."
          >
            <Seleccion
              value={formulario.modoFila}
              onChange={(e) => setFormulario((f) => ({ ...f, modoFila: e.target.value as ModoFila }))}
            >
              <option value="COMPARTIDA">{etiquetaModo.COMPARTIDA}</option>
              <option value="POR_PROFESIONAL">{etiquetaModo.POR_PROFESIONAL}</option>
            </Seleccion>
          </Campo>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={guardando}>
              {editando ? 'Guardar cambios' : 'Crear servicio'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

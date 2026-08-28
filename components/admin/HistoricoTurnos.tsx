'use client'

/**
 * Historico de turnos (requerimiento seccion 18).
 *
 * La misma pantalla sirve al administrador y al operador: el backend decide que
 * puede ver cada uno (el operador solo lo que el mismo llamo), asi que aqui
 * solo se ocultan los filtros que no le corresponden.
 */

import { useCallback, useEffect, useState } from 'react'
import { ClockCounterClockwise, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Seleccion, Tabla } from '@/components/admin/Campos'
import { hoyEnColombia, horaCorta, mensajeDeError, pedir } from '@/lib/api/cliente'
import type { EstadoTurno, Modulo, Servicio, Turno } from '@/lib/turnos/types'

const etiquetaEstado: Record<EstadoTurno, { texto: string; tono: 'blue' | 'green' | 'amber' | 'red' | 'slate' }> = {
  EN_ESPERA: { texto: 'En espera', tono: 'slate' },
  LLAMADO: { texto: 'Llamado', tono: 'blue' },
  EN_ATENCION: { texto: 'En atencion', tono: 'blue' },
  ATENDIDO: { texto: 'Atendido', tono: 'green' },
  AUSENTE: { texto: 'Ausente', tono: 'amber' },
  CANCELADO: { texto: 'Cancelado', tono: 'red' },
}

type Filtros = {
  fecha: string
  servicioId: string
  moduloId: string
  estado: string
  codigo: string
}

export default function HistoricoTurnos({ completo }: { completo: boolean }) {
  const [filtros, setFiltros] = useState<Filtros>({
    fecha: hoyEnColombia(),
    servicioId: '',
    moduloId: '',
    estado: '',
    codigo: '',
  })
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [buscando, setBuscando] = useState(true)

  useEffect(() => {
    Promise.all([
      pedir<{ servicios: Servicio[] }>('/api/turnos/servicios'),
      pedir<{ modulos: Modulo[] }>('/api/turnos/modulos'),
    ])
      .then(([s, m]) => {
        setServicios(s.servicios)
        setModulos(m.modulos)
      })
      .catch(() => {})
  }, [])

  const buscar = useCallback(async (activos: Filtros) => {
    setBuscando(true)
    const params = new URLSearchParams()
    for (const [clave, valor] of Object.entries(activos)) {
      if (valor) params.set(clave, valor)
    }

    try {
      const { turnos: lista } = await pedir<{ turnos: Turno[] }>(`/api/turnos/historico?${params}`)
      setTurnos(lista)
    } catch (error) {
      toast.error('No se pudo consultar el historico', mensajeDeError(error))
    } finally {
      setBuscando(false)
    }
  }, [])

  // Solo la carga inicial con los filtros por defecto; despues se busca con el
  // boton, para no lanzar una consulta con cada tecla.
  useEffect(() => {
    buscar({ fecha: hoyEnColombia(), servicioId: '', moduloId: '', estado: '', codigo: '' })
  }, [buscar])

  const nombre = (lista: Array<{ id: string; nombre: string }>, id?: string | null) =>
    id ? (lista.find((x) => x.id === id)?.nombre ?? '—') : '—'

  return (
    <div className="space-y-5">
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            buscar(filtros)
          }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <Campo etiqueta="Fecha">
            <Entrada
              type="date"
              value={filtros.fecha}
              onChange={(e) => setFiltros((f) => ({ ...f, fecha: e.target.value }))}
            />
          </Campo>

          <Campo etiqueta="Servicio">
            <Seleccion
              value={filtros.servicioId}
              onChange={(e) => setFiltros((f) => ({ ...f, servicioId: e.target.value }))}
            >
              <option value="">Todos</option>
              {servicios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          {completo ? (
            <Campo etiqueta="Modulo">
              <Seleccion
                value={filtros.moduloId}
                onChange={(e) => setFiltros((f) => ({ ...f, moduloId: e.target.value }))}
              >
                <option value="">Todos</option>
                {modulos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          ) : null}

          <Campo etiqueta="Estado">
            <Seleccion
              value={filtros.estado}
              onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value }))}
            >
              <option value="">Todos</option>
              {Object.entries(etiquetaEstado).map(([valor, { texto }]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <div className="flex items-end gap-2">
            <Campo etiqueta="Turno" className="flex-1">
              <Entrada
                value={filtros.codigo}
                onChange={(e) => setFiltros((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
                placeholder="A-025"
              />
            </Campo>
            <Button type="submit" loading={buscando} className="mb-0">
              <MagnifyingGlass size={17} weight="bold" />
              Buscar
            </Button>
          </div>
        </form>
      </Card>

      <Card padded={false}>
        <CardHeader>
          <CardTitle>Resultados ({turnos.length})</CardTitle>
        </CardHeader>
        <CardContent padded={false}>
          {buscando ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Consultando...</p>
          ) : turnos.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={ClockCounterClockwise}
                title="Sin turnos"
                description="No hay turnos que coincidan con los filtros seleccionados."
              />
            </div>
          ) : (
            <Tabla columnas={['Turno', 'Servicio', 'Modulo', 'Generado', 'Llamado', 'Cierre', 'Llamadas', 'Estado']}>
              {turnos.map((turno) => (
                <tr key={turno.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-black text-brand-950">{turno.codigo}</td>
                  <td className="px-4 py-3 text-slate-600">{nombre(servicios, turno.servicioId)}</td>
                  <td className="px-4 py-3 text-slate-600">{nombre(modulos, turno.moduloId)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{horaCorta(turno.fechaGeneracion)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{horaCorta(turno.horaLlamado)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{horaCorta(turno.horaAtencion)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{turno.vecesLlamado}</td>
                  <td className="px-4 py-3">
                    <Badge tone={etiquetaEstado[turno.estado].tono}>{etiquetaEstado[turno.estado].texto}</Badge>
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

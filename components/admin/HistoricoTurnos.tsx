'use client'

/**
 * Historico de turnos (requerimiento seccion 18).
 *
 * La misma pantalla sirve al administrador y al operador: el backend decide que
 * puede ver cada uno (el operador solo lo que el mismo llamo), asi que aqui
 * solo se ocultan los filtros que no le corresponden.
 *
 * No hay boton de buscar: al mover un filtro la tabla se recarga sola (con un
 * retraso corto, ver `useValorConRetraso`).
 */

import { useCallback, useEffect, useState } from 'react'
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Seleccion, TablaSkeleton } from '@/components/admin/Campos'
import { COLUMNAS_DE_TURNOS, ETIQUETA_ESTADO_TURNO, TablaDeTurnos } from '@/components/admin/TablaDeTurnos'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import { useCatalogosDeTurnos, useUltimaPeticion, useValorConRetraso } from '@/lib/hooks'
import type { Turno } from '@/lib/turnos/types'

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
  // Con reintento, y con aviso si todavia no se pudieron cargar (ver el hook).
  const { servicios, modulos, fallo: falloCatalogos } = useCatalogosDeTurnos()
  const [buscando, setBuscando] = useState(true)
  // Si el servidor recorto el resultado: aviso FIJO, no un toast que se va.
  const [truncado, setTruncado] = useState(false)


  // Descarta la respuesta de una consulta que los filtros ya reemplazaron: la
  // mas lenta llegaba la ultima y ganaba, asi que la tabla podia quedar
  // mostrando el resultado de un filtro anterior al que marca la pantalla.
  const consultas = useUltimaPeticion()

  const buscar = useCallback(async (activos: Filtros) => {
    const consulta = consultas.iniciar()
    setBuscando(true)
    const params = new URLSearchParams()
    for (const [clave, valor] of Object.entries(activos)) {
      if (valor) params.set(clave, valor)
    }

    try {
      const { turnos: lista, truncado } = await pedir<{ turnos: Turno[]; truncado?: boolean }>(
        `/api/turnos/historico?${params}`,
        { signal: consulta.signal },
      )
      if (!consulta.esVigente()) return
      setTurnos(lista)
      // El servidor devuelve como mucho un techo de filas: si hay mas, se dice.
      setTruncado(Boolean(truncado))
    } catch (error) {
      if (!consulta.esVigente()) return
      // Se vacia: la tabla vieja bajo el filtro nuevo se leia como su resultado.
      setTurnos([])
      setTruncado(false)
      toast.error('No se pudo consultar el historico', mensajeDeError(error))
    } finally {
      if (consulta.esVigente()) setBuscando(false)
    }
  }, [consultas])

  // El retraso evita lanzar una consulta con cada tecla del campo de turno.
  const filtrosDiferidos = useValorConRetraso(filtros)
  useEffect(() => {
    buscar(filtrosDiferidos)
  }, [buscar, filtrosDiferidos])

  return (
    <div className="space-y-5">
      {falloCatalogos ? (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          No se pudieron cargar los servicios y consultorios: los nombres pueden salir vacios. Se sigue intentando solo.
        </p>
      ) : null}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Campo etiqueta="Fecha">
            <Entrada
              type="date"
              value={filtros.fecha}
              // Borrar la fecha consulta hoy (lo que hace el servidor sin
              // fecha), asi que el campo lo dice en vez de quedar en blanco.
              onChange={(e) => setFiltros((f) => ({ ...f, fecha: e.target.value || hoyEnColombia() }))}
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
              {Object.entries(ETIQUETA_ESTADO_TURNO).map(([valor, { texto }]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Turno">
            <Entrada
              value={filtros.codigo}
              onChange={(e) => setFiltros((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
              placeholder="A-025"
              maxLength={20}
            />
          </Campo>
        </div>
      </Card>

      <Card padded={false}>
        <CardHeader>
          <CardTitle>Resultados ({turnos.length})</CardTitle>
        </CardHeader>
        {truncado ? (
          <p role="status" className="mx-5 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            Hay mas turnos de los que se muestran. Acota las fechas o los filtros para verlos todos.
          </p>
        ) : null}
        <CardContent padded={false}>
          {buscando ? (
            <TablaSkeleton columnas={COLUMNAS_DE_TURNOS} />
          ) : turnos.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={ClockCounterClockwise}
                title="Sin turnos"
                description="No hay turnos que coincidan con los filtros seleccionados."
              />
            </div>
          ) : (
            <TablaDeTurnos turnos={turnos} servicios={servicios} modulos={modulos} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

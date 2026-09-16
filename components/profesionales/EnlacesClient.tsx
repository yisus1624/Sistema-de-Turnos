'use client'

/**
 * Enlaces de consultorio: el acceso temporal con el que cada doctor pasa sus
 * propios turnos.
 *
 * Mientras los medicos no tengan cuenta propia (RF pendiente, confirmado con
 * el hospital), entran por un enlace con vigencia limitada. Repartirlos y
 * renovarlos es trabajo del dia a dia —el doctor llega a su turno y necesita
 * su enlace—, no de configuracion; por eso esta pantalla esta separada del
 * catalogo de profesionales, que es donde se dan de alta y se les cambia la
 * jornada. Asi se le puede dar al operador del mostrador la tarea de repartir
 * enlaces sin abrirle tambien el catalogo, donde un cambio de jornada le
 * mueve la agenda a todo el mundo.
 *
 * La vigencia la elige quien genera el enlace, porque el hospital tiene turnos
 * de mañana, tarde y noche que duran distinto.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  IdentificationCard,
  Link as LinkIcon,
  MagnifyingGlass,
  Prohibit,
} from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import type { AccesoProfesional, Jornada, Modulo, Profesional, Servicio } from '@/lib/turnos/types'

const COLUMNAS = ['Profesional', 'Servicio', 'Jornada', 'Consultorio', 'Enlace', '']

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

type EstadoAcceso = 'vigente' | 'vencido' | 'revocado' | 'sin_enlace'

/**
 * Valor del filtro de consultorio para "los que no tienen ninguno".
 *
 * No es un id de modulo y no puede serlo: un doctor sin consultorio asignado
 * es justo el que hay que encontrar para asignarselo, y sin esta opcion
 * quedaba fuera de todos los filtros.
 */
const SIN_CONSULTORIO = 'sin-consultorio'

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

/**
 * El servidor solo guarda el hash del token: el enlace en claro no se puede
 * volver a pedir. Para poder "ver" un enlace vigente sin generar uno nuevo, se
 * guarda una copia en el navegador de quien lo genero, y se valida contra
 * `expiraEn` para saber si sigue siendo el acceso actual.
 *
 * EN `sessionStorage`, NO EN `localStorage`. Ese token es una llave que abre la
 * agenda con nombres de pacientes sin pedir usuario ni contrasena; el servidor
 * se toma el trabajo de no guardarlo en claro justamente por eso. Guardarlo en
 * `localStorage` lo dejaba escrito en el disco del equipo del mostrador
 * indefinidamente: sobrevivia al cierre de sesion y al cierre del navegador, y
 * quedaba ahi para el siguiente que se sentara. En `sessionStorage` vive solo
 * mientras esa pestaña este abierta. Un enlace vencido, ademas, se borra al
 * leerlo.
 */
function claveCache(profesionalId: string) {
  return `enlace-profesional:${profesionalId}`
}

function leerEnlaceCacheado(profesionalId: string): { url: string; expiraEn: string } | null {
  try {
    const raw = sessionStorage.getItem(claveCache(profesionalId))
    if (!raw) return null

    const guardado = JSON.parse(raw) as { url: string; expiraEn: string }
    // Un token vencido ya no sirve para nada y no tiene por que seguir guardado.
    if (new Date(guardado.expiraEn).getTime() <= Date.now()) {
      limpiarEnlaceCacheado(profesionalId)
      return null
    }

    return guardado
  } catch {
    return null
  }
}

function guardarEnlaceCacheado(profesionalId: string, data: { url: string; expiraEn: string }) {
  try {
    sessionStorage.setItem(claveCache(profesionalId), JSON.stringify(data))
  } catch {
    // sessionStorage puede fallar (modo privado, cuota llena); no es critico.
  }
}

function limpiarEnlaceCacheado(profesionalId: string) {
  try {
    sessionStorage.removeItem(claveCache(profesionalId))
  } catch {
    // ver comentario de guardarEnlaceCacheado.
  }
}

export default function EnlacesClient() {
  const [profesionales, setProfesionales] = useState<Profesional[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [accesos, setAccesos] = useState<AccesoProfesional[]>([])
  const [cargando, setCargando] = useState(true)

  // Filtros de la tabla. El hospital tiene dieciocho doctores y va a tener
  // mas: repartir el enlace es buscar UNO concreto —el que acaba de llegar a
  // su turno— en una lista alfabetica que no cabe en la pantalla. Se busca por
  // lo que se sabe de el en ese momento: su nombre, su jornada o el
  // consultorio en el que esta sentado.
  const [busqueda, setBusqueda] = useState('')
  const [jornadaFiltro, setJornadaFiltro] = useState<'' | Jornada>('')
  const [consultorioFiltro, setConsultorioFiltro] = useState('')

  // Modal de generacion.
  const [profesionalActivo, setProfesionalActivo] = useState<Profesional | null>(null)
  const [horas, setHoras] = useState(12)
  const [minutos, setMinutos] = useState(0)
  const [generando, setGenerando] = useState(false)

  // Resultado a mostrar: recien generado, o el vigente recuperado del cache.
  const [enlaceGenerado, setEnlaceGenerado] = useState<{ url: string; expiraEn: string } | null>(null)
  const [enlaceEsNuevo, setEnlaceEsNuevo] = useState(false)
  // Hay un acceso vigente pero su enlace no esta en el cache de este navegador.
  const [sinCacheVigente, setSinCacheVigente] = useState(false)
  const [copiado, setCopiado] = useState(false)

  // Confirmacion de revocar.
  const [aRevocar, setARevocar] = useState<AccesoProfesional | null>(null)
  const [revocando, setRevocando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      // Solo profesionales activos: a un doctor dado de baja no se le reparte
      // enlace, y quien esta en esta pantalla no necesariamente administra el
      // catalogo como para reactivarlo.
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
      toast.error('No se pudieron cargar los enlaces', mensajeDeError(error))
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

  /**
   * Los consultorios que se ofrecen en el filtro.
   *
   * Salen de los doctores de la tabla, no del catalogo de modulos: las
   * ventanillas de admisiones y facturacion tambien son modulos, y ofrecerlas
   * aqui seria ofrecer un filtro que no devuelve a nadie.
   */
  const consultoriosDelFiltro = useMemo(() => {
    const ids = new Set(profesionales.map((p) => p.moduloId).filter((id): id is string => !!id))
    return [...ids]
      .map((id) => ({ id, nombre: nombreModulo(id) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [profesionales, nombreModulo])

  const hayDoctorSinConsultorio = useMemo(() => profesionales.some((p) => !p.moduloId), [profesionales])

  const filtrando = busqueda.trim() !== '' || jornadaFiltro !== '' || consultorioFiltro !== ''

  /**
   * La tabla ya filtrada.
   *
   * La busqueda mira tambien el servicio y el consultorio, no solo el nombre:
   * quien reparte los enlaces no siempre tiene el nombre del doctor a mano,
   * pero si sabe que es "el de odontologia" o "el del CONS 03".
   */
  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    return profesionales.filter((profesional) => {
      if (jornadaFiltro && profesional.jornada !== jornadaFiltro) return false
      if (consultorioFiltro === SIN_CONSULTORIO) {
        if (profesional.moduloId) return false
      } else if (consultorioFiltro && profesional.moduloId !== consultorioFiltro) {
        return false
      }
      if (!texto) return true
      const buscable = [
        profesional.nombre,
        nombreServicio(profesional.servicioId),
        nombreModulo(profesional.moduloId),
      ]
        .join(' ')
        .toLowerCase()
      return buscable.includes(texto)
    })
  }, [profesionales, busqueda, jornadaFiltro, consultorioFiltro, nombreServicio, nombreModulo])

  function limpiarFiltros() {
    setBusqueda('')
    setJornadaFiltro('')
    setConsultorioFiltro('')
  }

  const ultimoAccesoDe = useCallback(
    (profesionalId: string) => accesos.find((a) => a.profesionalId === profesionalId),
    [accesos],
  )

  const vigentes = useMemo(
    () => profesionales.filter((p) => estadoDelAcceso(ultimoAccesoDe(p.id)) === 'vigente').length,
    [profesionales, ultimoAccesoDe],
  )

  function abrirGenerar(profesional: Profesional) {
    setProfesionalActivo(profesional)
    setHoras(12)
    setMinutos(0)
    setCopiado(false)
    setEnlaceEsNuevo(false)
    setSinCacheVigente(false)

    const acceso = ultimoAccesoDe(profesional.id)
    if (estadoDelAcceso(acceso) === 'vigente' && acceso) {
      const cacheado = leerEnlaceCacheado(profesional.id)
      if (cacheado && cacheado.expiraEn === acceso.expiraEn) {
        setEnlaceGenerado(cacheado)
        return
      }
      setEnlaceGenerado(null)
      setSinCacheVigente(true)
      return
    }
    setEnlaceGenerado(null)
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
      setEnlaceEsNuevo(true)
      setSinCacheVigente(false)
      guardarEnlaceCacheado(profesionalActivo.id, data)
      toast.success('Enlace generado', `Para ${profesionalActivo.nombre}.`)
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
      limpiarEnlaceCacheado(aRevocar.profesionalId)
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
          <CardTitle>Doctores ({profesionales.length})</CardTitle>
          <span className="text-sm font-bold text-slate-500">
            {vigentes} con enlace vigente
          </span>
        </CardHeader>
        {/*
          La barra de filtros solo cuando de verdad hace falta. Con cuatro
          doctores estorba y no ahorra nada; pasada la decena es la unica forma
          de llegar al que se busca sin recorrer la tabla entera.
        */}
        {!cargando && profesionales.length > 6 ? (
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-4">
            <Campo etiqueta="Buscar doctor, servicio o consultorio" className="w-full max-w-xs">
              <div className="relative">
                <MagnifyingGlass
                  size={17}
                  weight="bold"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <Entrada
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Perez, odontologia, CONS 03..."
                  className="pl-9"
                />
              </div>
            </Campo>

            <Campo etiqueta="Jornada" className="w-full max-w-[180px]">
              <Seleccion
                value={jornadaFiltro}
                onChange={(e) => setJornadaFiltro(e.target.value as '' | Jornada)}
              >
                <option value="">Todas</option>
                <option value="MANANA">{etiquetaJornada.MANANA}</option>
                <option value="TARDE">{etiquetaJornada.TARDE}</option>
                <option value="COMPLETA">{etiquetaJornada.COMPLETA}</option>
              </Seleccion>
            </Campo>

            {consultoriosDelFiltro.length > 1 ? (
              <Campo etiqueta="Consultorio" className="w-full max-w-[240px]">
                <Seleccion
                  value={consultorioFiltro}
                  onChange={(e) => setConsultorioFiltro(e.target.value)}
                >
                  <option value="">Todos</option>
                  {consultoriosDelFiltro.map((consultorio) => (
                    <option key={consultorio.id} value={consultorio.id}>
                      {consultorio.nombre}
                    </option>
                  ))}
                  {hayDoctorSinConsultorio ? (
                    <option value={SIN_CONSULTORIO}>Sin consultorio</option>
                  ) : null}
                </Seleccion>
              </Campo>
            ) : null}

            <div className="flex items-center gap-3 pb-0.5">
              <span className="text-sm font-bold text-slate-500">
                {visibles.length} de {profesionales.length} doctores
              </span>
              {filtrando ? (
                <Button variant="secondary" size="sm" onClick={limpiarFiltros}>
                  Ver todos
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <CardContent padded={false}>
          {cargando ? (
            <TablaSkeleton columnas={COLUMNAS} />
          ) : profesionales.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={IdentificationCard}
                title="Sin doctores activos"
                description="Todavia no hay doctores a los que repartirles enlace. Se dan de alta en Profesionales."
              />
            </div>
          ) : visibles.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={MagnifyingGlass}
                title="Ningun doctor coincide"
                description="Prueba con otro nombre o quita los filtros para ver a todos los doctores."
                action={
                  <Button variant="secondary" onClick={limpiarFiltros}>
                    Ver todos
                  </Button>
                }
              />
            </div>
          ) : (
            <Tabla columnas={COLUMNAS}>
              {visibles.map((profesional) => {
                const acceso = ultimoAccesoDe(profesional.id)
                const estado = estadoDelAcceso(acceso)
                return (
                  <tr
                    key={profesional.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => abrirGenerar(profesional)}
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
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation()
                            abrirGenerar(profesional)
                          }}
                        >
                          <LinkIcon size={16} weight="bold" />
                          {estado === 'vigente' ? 'Ver enlace' : 'Generar enlace'}
                        </Button>
                        {estado === 'vigente' && acceso ? (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={(e) => {
                              e.stopPropagation()
                              setARevocar(acceso)
                            }}
                          >
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
        title={profesionalActivo?.nombre ?? ''}
        description={
          profesionalActivo
            ? `${nombreServicio(profesionalActivo.servicioId)} · ${nombreModulo(profesionalActivo.moduloId)}`
            : undefined
        }
      >
        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Enlace de acceso</p>
        {enlaceGenerado ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {enlaceEsNuevo
                ? 'Copialo y enviaselo al doctor ahora.'
                : 'Este es el enlace activo para este profesional en este dispositivo.'}
            </p>
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
              Vence el <strong>{formatoFechaHora(enlaceGenerado.expiraEn)}</strong> ({tiempoRestante(enlaceGenerado.expiraEn)}).
            </p>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setProfesionalActivo(null)}>
                Listo
              </Button>
            </div>
          </div>
        ) : sinCacheVigente ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Ya se genero un enlace para este profesional y sigue vigente, pero no se puede volver a mostrar en
              este dispositivo. Puedes generar uno nuevo: el anterior dejara de funcionar de inmediato.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setProfesionalActivo(null)}>
                Cancelar
              </Button>
              <Button onClick={() => setSinCacheVigente(false)}>Generar uno nuevo</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Elige cuanto debe durar el enlace. Se pensó para que coincida con la duracion del turno del doctor.
            </p>
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

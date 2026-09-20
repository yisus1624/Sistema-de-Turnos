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
 *
 * EL ENLACE VIGENTE SE PUEDE VOLVER A VER, desde cualquier equipo y sin
 * generar otro. Es lo que pide el mostrador: se borra el mensaje, lo genero el
 * compañero del otro turno, se cerro el navegador —y hasta ahora la unica
 * salida era crear uno nuevo, lo que revoca el anterior y deja fuera al doctor
 * que en ese momento esta llamando pacientes—.
 *
 * Lo que VALIDA la entrada sigue siendo el hash del token. Aparte, el servidor
 * guarda una copia cifrada que solo existe mientras el enlace esta vivo: se
 * borra al revocarlo, al generar otro y al encontrarlo vencido (ver
 * `tokenVigenteDeProfesional` y `lib/seguridad/cifrado.ts`). El boton del ojo
 * la pide; un enlace muerto no se puede mostrar por ninguna via.
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Broom,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  Check,
  Clock,
  ClockCounterClockwise,
  Copy,
  Eye,
  EyeSlash,
  Faders,
  IdentificationCard,
  Link as LinkIcon,
  LinkBreak,
  MagnifyingGlass,
  MapPin,
  MoonStars,
  Prohibit,
  ShieldCheck,
  Sun,
  User,
} from '@phosphor-icons/react/dist/ssr'
import type { Icon } from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'
import EmptyState from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Loader'
import { toast } from '@/components/ui/toast'
import { TarjetaIndicador, TONOS_INDICADOR } from '@/components/ui/TarjetaIndicador'
import { iconoDeServicio } from '@/components/ui/iconos-servicio'
import { Campo, Entrada, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import type {
  AccesoProfesional,
  Jornada,
  JornadaDelDia,
  Modulo,
  Profesional,
  Servicio,
} from '@/lib/turnos/types'

/**
 * LA COLUMNA "SERVICIO" SE FUE, Y NO ES UN OLVIDO.
 *
 * Decia exactamente lo mismo que el renglon que va debajo del nombre del
 * doctor, asi que el mismo texto —"Consulta externa", que no es corto— ocupaba
 * ancho dos veces en cada fila. Con siete columnas y nombres de consultorio
 * como "CONS 01- CONSULTA EXTERNA", la tabla ya no cabia en la pantalla y el
 * boton de generar el enlace, que es a lo que se viene, quedaba cortado detras
 * de una barra de desplazamiento horizontal.
 *
 * El servicio no se pierde: sigue bajo el nombre, ahora con su icono al lado.
 */
const COLUMNAS = ['Profesional', 'Jornada', 'Hora', 'Consultorio', 'Estado', '']

const etiquetaJornada: Record<Jornada, string> = {
  MANANA: 'Mañana',
  TARDE: 'Tarde',
  COMPLETA: 'Dia completo',
}

/**
 * Como se ve cada jornada.
 *
 * El sol y la luna no son adorno: la jornada se busca recorriendo la columna de
 * arriba abajo, y a ese ritmo la forma del icono se reconoce antes que la
 * palabra. El dia completo lleva reloj porque no es "ni mañana ni tarde", es
 * las dos.
 */
const estiloJornada: Record<Jornada, { icono: Icon; chip: string }> = {
  MANANA: { icono: Sun, chip: 'bg-amber-50 text-amber-700 ring-amber-100' },
  TARDE: { icono: MoonStars, chip: 'bg-acento-50 text-acento-700 ring-acento-100' },
  COMPLETA: { icono: Clock, chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
}

/**
 * El icono de una jornada, ya pintado.
 *
 * Devuelve el elemento y no el componente: guardar un componente en una
 * variable durante el render es lo que prohibe la regla de React que vigila
 * este proyecto, porque un componente que nace en cada render pierde su estado.
 */
function iconoDeJornada(jornada: Jornada, size: number) {
  return createElement(estiloJornada[jornada].icono, { size, weight: 'fill' })
}

/**
 * Color del disco de cada doctor, por su servicio. Se asigna por posicion del
 * servicio en el catalogo, no al azar, para que el mismo doctor tenga siempre
 * el mismo color: en una tabla larga, el color es lo que deja ver de un golpe
 * que tres filas seguidas son del mismo servicio.
 */
const COLORES_SERVICIO = [
  'bg-acento-50 text-acento-600',
  'bg-emerald-50 text-emerald-600',
  'bg-violet-50 text-violet-600',
  'bg-rose-50 text-rose-600',
  'bg-amber-50 text-amber-600',
  'bg-cyan-50 text-cyan-600',
]

/** "07:00" → "07:00 a. m.", que es como se dice y como se lee un horario. */
function enDoceHoras(hhmm: string) {
  const [hora, minuto] = hhmm.split(':').map(Number)
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hora, minuto)))
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

/**
 * Como se ve cada estado del enlace.
 *
 * Vencido y revocado NO comparten color con "sin enlace", aunque los tres
 * acaben en "genera uno". Un enlace vencido es uno que el doctor tuvo y esta
 * intentando usar ahora mismo —esa es la llamada que entra al mostrador—, y
 * "sin enlace" es alguien a quien nunca se le dio. Pintarlos igual borraba esa
 * diferencia justo en la columna que se mira para decidir a quien atender
 * primero.
 */
const estiloEstado: Record<EstadoAcceso, { chip: string; punto: string }> = {
  vigente: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100', punto: 'bg-emerald-500' },
  vencido: { chip: 'bg-amber-50 text-amber-700 ring-amber-100', punto: 'bg-amber-400' },
  revocado: { chip: 'bg-amber-50 text-amber-700 ring-amber-100', punto: 'bg-amber-400' },
  sin_enlace: { chip: 'bg-slate-100 text-slate-600 ring-slate-200', punto: 'bg-slate-400' },
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
  const [servicioFiltro, setServicioFiltro] = useState('')
  const [jornadaFiltro, setJornadaFiltro] = useState<'' | Jornada>('')
  const [consultorioFiltro, setConsultorioFiltro] = useState('')

  /**
   * El dia que se esta repartiendo, y quien trabaja ESE dia.
   *
   * POR QUE NO SE LISTAN LOS DIECIOCHO. El catalogo de doctores lo va llenando
   * la carga diaria del reporte y crece con el tiempo, pero un dia cualquiera
   * atiende una parte: hoy ocho, cuatro en la mañana y cuatro en la tarde. Con
   * los dieciocho en la tabla, repartir los enlaces del dia es ir cazando ocho
   * nombres entre dieciocho, y cada fila de las otras diez ofrece un boton de
   * "Generar enlace" para alguien que hoy no viene.
   *
   * Quien trabaja ese dia lo dicen sus citas, no su ficha: la jornada de la
   * ficha es lo que ese medico SUELE hacer, y no sabe si hoy vino.
   */
  const [fecha, setFecha] = useState(hoyEnColombia)
  const [jornadasDelDia, setJornadasDelDia] = useState<Map<string, JornadaDelDia>>(new Map())
  const [cargandoJornadas, setCargandoJornadas] = useState(true)
  const [errorJornadas, setErrorJornadas] = useState(false)

  /**
   * Se ven solo los del dia. Se puede apagar, porque a veces hay que darle el
   * enlace a un doctor que entra a cubrir a otro y todavia no tiene citas.
   */
  const [soloDelDia, setSoloDelDia] = useState(true)

  // Modal de generacion.
  const [profesionalActivo, setProfesionalActivo] = useState<Profesional | null>(null)
  const [horas, setHoras] = useState(12)
  const [minutos, setMinutos] = useState(0)
  const [generando, setGenerando] = useState(false)

  // Resultado a mostrar: recien generado, o el vigente que devuelve el servidor.
  const [enlaceGenerado, setEnlaceGenerado] = useState<{ url: string; expiraEn: string } | null>(null)
  const [enlaceEsNuevo, setEnlaceEsNuevo] = useState(false)
  const [recuperando, setRecuperando] = useState(false)
  /**
   * Hay un acceso marcado como vigente pero el servidor no pudo devolver su
   * enlace. Pasa con los accesos creados antes de que se guardara la copia, y
   * si se rota la clave de cifrado con enlaces todavia vivos.
   */
  const [noSePudoRecuperar, setNoSePudoRecuperar] = useState(false)
  const [copiado, setCopiado] = useState(false)
  /**
   * El doctor cuyo enlace se esta pidiendo ahora mismo.
   *
   * Sirve para descartar una respuesta que llega tarde: pulsando rapido dos
   * filas seguidas, la del primer doctor podia aterrizar DESPUES de abrir el
   * segundo y pintar el enlace de otra persona encima de su nombre. Ahi el
   * mostrador reparte la llave equivocada.
   */
  const enlacePedidoRef = useRef<string | null>(null)

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

  /**
   * Solo los accesos, que es lo unico que otra persona puede cambiar mientras
   * esta pantalla esta abierta. En silencio: es un refresco de fondo y un aviso
   * de error cada treinta segundos seria peor que el problema.
   */
  const cargarAccesos = useCallback(async () => {
    try {
      const { accesos: lista } = await pedir<{ accesos: AccesoProfesional[] }>(
        '/api/profesionales/accesos',
      )
      setAccesos(lista)
    } catch {
      // Se queda la lista anterior: es mas util que vaciarla.
    }
  }, [])

  const cargarJornadas = useCallback(async (dia: string) => {
    setCargandoJornadas(true)
    try {
      const { jornadas } = await pedir<{ jornadas: JornadaDelDia[] }>(
        `/api/turnos/profesionales/jornadas?fecha=${dia}`,
      )
      setJornadasDelDia(new Map(jornadas.map((j) => [j.profesionalId, j])))
      setErrorJornadas(false)
    } catch (error) {
      // Aqui NO es silencioso: si no se sabe quien trabaja hoy, la tabla se
      // queda vacia con el filtro puesto, y el operador tiene que entender por
      // que en vez de creer que hoy no viene nadie.
      toast.error('No se pudo saber quien trabaja ese dia', mensajeDeError(error))
      setJornadasDelDia(new Map())
      setErrorJornadas(true)
    } finally {
      setCargandoJornadas(false)
    }
  }, [])

  useEffect(() => {
    cargarJornadas(fecha)
  }, [cargarJornadas, fecha])

  /**
   * Refresco periodico: la cuenta atras Y los accesos.
   *
   * Antes solo repintaba, para que el "faltan 3 h 20 min" no se quedara viejo.
   * Eso dejaba un hueco con consecuencia real: si el administrador revocaba un
   * enlace desde su equipo, en el mostrador la fila seguia diciendo "Vigente"
   * durante horas, y como ademas ese mostrador conserva la copia en su
   * navegador, se la podia volver a mostrar y entregar. El doctor perdia su
   * jornada intentando entrar con un enlace muerto.
   *
   * Se vuelven a pedir los accesos, que es lo que puede haber cambiado en otro
   * equipo. Las jornadas del dia no: esas dependen de la fecha elegida y de la
   * agenda, que no se mueve sola cada treinta segundos.
   */
  const [, forzarRefresco] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      forzarRefresco((n) => n + 1)
      cargarAccesos()
    }, 30_000)
    return () => clearInterval(id)
  }, [cargarAccesos])

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

  /**
   * Las especialidades que se ofrecen en el filtro.
   *
   * Salen de los doctores de la tabla, no del catalogo de servicios: los de
   * ventanilla no llevan profesional, asi que ofrecerlos aqui seria ofrecer un
   * filtro que nunca devuelve a nadie.
   */
  const serviciosDelFiltro = useMemo(() => {
    const ids = new Set(profesionales.map((profesional) => profesional.servicioId))
    return servicios
      .filter((servicio) => ids.has(servicio.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [profesionales, servicios])

  /** El color del disco de un doctor, estable por servicio. */
  const colorDeServicio = useMemo(() => {
    const orden = new Map(servicios.map((servicio, indice) => [servicio.id, indice]))
    return (servicioId: string) =>
      COLORES_SERVICIO[(orden.get(servicioId) ?? 0) % COLORES_SERVICIO.length]
  }, [servicios])

  /**
   * Un dia adelante o atras.
   *
   * Se calcula sobre la fecha en texto y a mediodia UTC: partiendo de
   * medianoche, un equipo configurado en otra zona saltaria dos dias o ninguno
   * al sumar uno.
   */
  const moverDia = useCallback((dias: number) => {
    setFecha((actual) => {
      const dia = new Date(`${actual}T12:00:00Z`)
      dia.setUTCDate(dia.getUTCDate() + dias)
      return dia.toISOString().slice(0, 10)
    })
  }, [])

  const filtrando =
    busqueda.trim() !== '' || servicioFiltro !== '' || jornadaFiltro !== '' || consultorioFiltro !== ''

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
      const delDia = jornadasDelDia.get(profesional.id)

      // El que ese dia no tiene ni un paciente no sale: no hay a quien darle el
      // enlace, y su fila solo estorba entre las que si hay que repartir.
      //
      // Si la consulta del dia FALLO no se filtra nada: con el mapa vacio, el
      // filtro dejaba la tabla sin una sola fila y el mostrador se quedaba sin
      // poder repartir enlaces por un corte de red.
      if (soloDelDia && !errorJornadas && !delDia?.jornada) return false

      // El filtro de jornada mira LA DEL DIA cuando se sabe, y la de la ficha
      // solo cuando no hay citas. "Los de la mañana" significa los que hoy
      // atienden en la mañana, no los que suelen hacerlo.
      const jornadaQueCuenta = delDia?.jornada ?? profesional.jornada
      if (jornadaFiltro && jornadaQueCuenta !== jornadaFiltro) return false
      if (servicioFiltro && profesional.servicioId !== servicioFiltro) return false
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
  }, [
    profesionales,
    busqueda,
    servicioFiltro,
    jornadaFiltro,
    consultorioFiltro,
    nombreServicio,
    nombreModulo,
    jornadasDelDia,
    soloDelDia,
    errorJornadas,
  ])

  /** Cuantos doctores trabajan el dia que se esta mirando. */
  const trabajanEseDia = useMemo(
    () => profesionales.filter((p) => jornadasDelDia.get(p.id)?.jornada).length,
    [profesionales, jornadasDelDia],
  )

  function limpiarFiltros() {
    setBusqueda('')
    setServicioFiltro('')
    setJornadaFiltro('')
    setConsultorioFiltro('')
  }

  const ultimoAccesoDe = useCallback(
    (profesionalId: string) => accesos.find((a) => a.profesionalId === profesionalId),
    [accesos],
  )

  /**
   * Las cifras de la cabecera, sobre los doctores QUE ESTAN EN LA TABLA.
   *
   * No sobre el catalogo entero: con el filtro del dia puesto, decir "118
   * vigentes" mientras en pantalla hay ocho filas manda a buscar los otros
   * ciento diez a una lista que no existe. La cifra tiene que poder
   * comprobarse con lo que se ve.
   */
  const enElAlcance = soloDelDia ? trabajanEseDia : profesionales.length

  const resumenEnlaces = useMemo(() => {
    const delAlcance = soloDelDia
      ? profesionales.filter((p) => jornadasDelDia.get(p.id)?.jornada)
      : profesionales

    let vigentes = 0
    let caidos = 0
    let sinEnlace = 0
    for (const profesional of delAlcance) {
      const estado = estadoDelAcceso(ultimoAccesoDe(profesional.id))
      if (estado === 'vigente') vigentes += 1
      else if (estado === 'sin_enlace') sinEnlace += 1
      else caidos += 1
    }
    return { vigentes, caidos, sinEnlace }
  }, [profesionales, jornadasDelDia, soloDelDia, ultimoAccesoDe])

  /** "83% del total" — el porcentaje se calcula sobre lo que hay en la tabla. */
  function porcentaje(cuantos: number) {
    if (enElAlcance === 0) return 'sin doctores en la lista'
    return `${Math.round((cuantos / enElAlcance) * 100)}% de los ${enElAlcance}`
  }

  async function abrirGenerar(profesional: Profesional) {
    setProfesionalActivo(profesional)
    setHoras(12)
    setMinutos(0)
    setCopiado(false)
    setEnlaceEsNuevo(false)
    setNoSePudoRecuperar(false)
    setEnlaceGenerado(null)

    const acceso = ultimoAccesoDe(profesional.id)
    // Sin enlace vivo no hay nada que recuperar: el detalle abre directamente
    // en el formulario de vigencia.
    if (!acceso || estadoDelAcceso(acceso) !== 'vigente') {
      enlacePedidoRef.current = null
      return
    }

    enlacePedidoRef.current = profesional.id
    setRecuperando(true)
    try {
      const { url } = await pedir<{ url: string }>(
        `/api/profesionales/${profesional.id}/acceso/enlace`,
      )
      if (enlacePedidoRef.current !== profesional.id) return
      setEnlaceGenerado({ url, expiraEn: acceso.expiraEn })
    } catch {
      if (enlacePedidoRef.current !== profesional.id) return
      // Sin aviso emergente: el detalle ya esta abierto y explica ahi mismo
      // que paso y cual es la salida.
      setNoSePudoRecuperar(true)
    } finally {
      if (enlacePedidoRef.current === profesional.id) setRecuperando(false)
    }
  }

  /** El acceso vigente del doctor abierto en el detalle, si lo tiene. */
  const accesoActivo = useMemo(() => {
    if (!profesionalActivo) return null
    const acceso = ultimoAccesoDe(profesionalActivo.id)
    return acceso && estadoDelAcceso(acceso) === 'vigente' ? acceso : null
  }, [profesionalActivo, ultimoAccesoDe])

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
      setNoSePudoRecuperar(false)
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
      // La copia cifrada la borra el servidor en la misma escritura que revoca,
      // asi que a partir de aqui el enlace no se puede mostrar desde ningun
      // equipo. Se cierra el detalle por si era el que estaba abierto.
      toast.info('Enlace revocado', 'El doctor ya no podra usarlo.')
      setARevocar(null)
      setProfesionalActivo(null)
      setEnlaceGenerado(null)
      await cargar()
    } catch (error) {
      toast.error('No se pudo revocar', mensajeDeError(error))
    } finally {
      setRevocando(false)
    }
  }

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaIndicador
          icono={LinkIcon}
          etiqueta={soloDelDia ? 'Doctores del dia' : 'Doctores'}
          valor={enElAlcance}
          detalle={soloDelDia ? 'Con citas ese dia' : 'Todo el catalogo activo'}
          tono={TONOS_INDICADOR.acento}
        />
        <TarjetaIndicador
          icono={ShieldCheck}
          etiqueta="Enlace vigente"
          valor={resumenEnlaces.vigentes}
          detalle={porcentaje(resumenEnlaces.vigentes)}
          tono={TONOS_INDICADOR.verde}
        />
        {/*
          Vencido y revocado se cuentan juntos: son dos causas distintas pero
          la misma consecuencia y la misma salida —ese doctor no puede entrar y
          hay que generarle otro—. Separarlos daria dos cifras que siempre se
          miran a la vez.
        */}
        <TarjetaIndicador
          icono={ClockCounterClockwise}
          etiqueta="Enlace caido"
          valor={resumenEnlaces.caidos}
          detalle="Vencidos o revocados"
          tono={TONOS_INDICADOR.ambar}
        />
        <TarjetaIndicador
          icono={LinkBreak}
          etiqueta="Sin enlace"
          valor={resumenEnlaces.sinEnlace}
          detalle="Nunca se les genero uno"
          tono={TONOS_INDICADOR.rojo}
        />
      </div>

      {/*
        EL DIA, ANTES QUE LA TABLA. Repartir enlaces es una tarea de un dia
        concreto —el de hoy, casi siempre—, y la tabla contesta a "quien
        trabaja ese dia". Poder mover la fecha ademas deja mirar hacia atras
        quien atendio ayer sin tener que deducirlo de otra pantalla.
      */}
      <Card padded={false} className="mb-5 rounded-[1.375rem] p-4 md:px-5 md:py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-3">
            <CalendarBlank size={18} weight="bold" className="shrink-0 text-acento-500" />
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              aria-label="Dia que se esta repartiendo"
              className="w-[8.5rem] border-0 bg-transparent p-0 text-sm font-semibold tabular-nums text-brand-950 outline-none"
            />
            <span className="flex items-center gap-0.5 border-l border-slate-200/80 pl-1.5">
              <button
                type="button"
                onClick={() => moverDia(-1)}
                aria-label="Dia anterior"
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors duration-[var(--suave)] ease-[var(--curva)] hover:bg-acento-50 hover:text-acento-600 active:scale-95 active:transition-transform active:duration-[var(--toque)]"
              >
                <CaretLeft size={15} weight="bold" />
              </button>
              <button
                type="button"
                onClick={() => moverDia(1)}
                aria-label="Dia siguiente"
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors duration-[var(--suave)] ease-[var(--curva)] hover:bg-acento-50 hover:text-acento-600 active:scale-95 active:transition-transform active:duration-[var(--toque)]"
              >
                <CaretRight size={15} weight="bold" />
              </button>
            </span>
          </div>

          {fecha !== hoyEnColombia() ? (
            <Button variant="secondary" onClick={() => setFecha(hoyEnColombia())}>
              <CalendarBlank size={17} weight="bold" />
              Hoy
            </Button>
          ) : null}

          <div className="relative min-w-[15rem] flex-1">
            <MagnifyingGlass
              size={17}
              weight="bold"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Entrada
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por doctor, servicio o consultorio..."
              aria-label="Buscar doctor, servicio o consultorio"
              className="pl-9"
            />
          </div>
        </div>

        {/*
          Los filtros en su propia fila y con el ancho de su opcion mas larga.
          El ancho va en el contenedor y no en el campo: las clases base de
          `Seleccion` traen `w-full`, y sobrescribirlas desde fuera dependeria
          del orden en que Tailwind emita las dos reglas.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <div className="relative w-full sm:w-[16.5rem]">
            <Faders
              size={17}
              weight="bold"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Seleccion
              value={servicioFiltro}
              onChange={(e) => setServicioFiltro(e.target.value)}
              aria-label="Especialidad"
              className="pl-9"
            >
              <option value="">Todas las especialidades</option>
              {serviciosDelFiltro.map((servicio) => (
                <option key={servicio.id} value={servicio.id}>
                  {servicio.nombre}
                </option>
              ))}
            </Seleccion>
          </div>

          <div className="w-full sm:w-[13rem]">
            <Seleccion
              value={jornadaFiltro}
              onChange={(e) => setJornadaFiltro(e.target.value as '' | Jornada)}
              aria-label="Jornada"
            >
              <option value="">Todas las jornadas</option>
              <option value="MANANA">{etiquetaJornada.MANANA}</option>
              <option value="TARDE">{etiquetaJornada.TARDE}</option>
              <option value="COMPLETA">{etiquetaJornada.COMPLETA}</option>
            </Seleccion>
          </div>

          {consultoriosDelFiltro.length > 1 ? (
            <div className="w-full sm:w-[14rem]">
              <Seleccion
                value={consultorioFiltro}
                onChange={(e) => setConsultorioFiltro(e.target.value)}
                aria-label="Consultorio"
              >
                <option value="">Todos los consultorios</option>
                {consultoriosDelFiltro.map((consultorio) => (
                  <option key={consultorio.id} value={consultorio.id}>
                    {consultorio.nombre}
                  </option>
                ))}
                {hayDoctorSinConsultorio ? (
                  <option value={SIN_CONSULTORIO}>Sin consultorio</option>
                ) : null}
              </Seleccion>
            </div>
          ) : null}

          {filtrando ? (
            <Button variant="secondary" className="sm:ml-auto" onClick={limpiarFiltros}>
              <Broom size={16} weight="bold" className="text-slate-500" />
              Limpiar filtros
            </Button>
          ) : null}
        </div>
      </Card>

      <Card padded={false} className="rounded-[1.375rem]">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-acento-50 text-acento-600">
              <LinkIcon size={20} weight="bold" />
            </span>
            <div className="min-w-0">
              <CardTitle>Lista de enlaces de consultorio ({visibles.length})</CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                {soloDelDia
                  ? 'Solo los doctores con citas el dia seleccionado'
                  : 'Todo el catalogo de doctores activos'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            {/*
              Se dice CUANTOS quedan fuera, no se esconden en silencio: quien
              busca a un doctor concreto y no lo ve tiene que poder entender
              por que, o va a creer que no esta registrado.
            */}
            {trabajanEseDia < profesionales.length ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSoloDelDia((antes) => !antes)}
                aria-pressed={soloDelDia}
              >
                {soloDelDia ? (
                  <Eye size={16} weight="bold" className="text-slate-500" />
                ) : (
                  <EyeSlash size={16} weight="bold" className="text-slate-500" />
                )}
                {soloDelDia
                  ? `Ver los ${profesionales.length} del catalogo`
                  : `Solo los ${trabajanEseDia} de ese dia`}
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent padded={false}>
          {cargando ? (
            <TablaSkeleton columnas={COLUMNAS} />
          ) : profesionales.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={IdentificationCard}
                title="Sin doctores activos"
                description="Todavia no hay doctores a los que repartirles enlace. Los trae la carga del reporte en Citas."
              />
            </div>
          ) : visibles.length === 0 ? (
            <div className="p-5">
              {/*
                La tabla vacia por el dia y la tabla vacia por el filtro son dos
                cosas distintas, y decir "ningun doctor coincide" cuando lo que
                pasa es que ese dia no hay agenda cargada manda a buscar el
                problema donde no esta.
              */}
              <EmptyState
                icon={soloDelDia && trabajanEseDia === 0 ? IdentificationCard : MagnifyingGlass}
                title={
                  soloDelDia && trabajanEseDia === 0
                    ? 'Ningun doctor trabaja ese dia'
                    : 'Ningun doctor coincide'
                }
                description={
                  soloDelDia && trabajanEseDia === 0
                    ? 'Ninguno tiene citas ese dia. Si la agenda todavia no se ha cargado, subela en Citas; si necesitas darle el enlace a alguien igualmente, muestra el catalogo completo.'
                    : 'Prueba con otro nombre o quita los filtros para ver a todos los doctores.'
                }
                action={
                  soloDelDia && trabajanEseDia === 0 ? (
                    <Button variant="secondary" onClick={() => setSoloDelDia(false)}>
                      Ver los {profesionales.length} del catalogo
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={limpiarFiltros}>
                      Quitar filtros
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <Tabla columnas={COLUMNAS}>
              {visibles.map((profesional) => {
                const acceso = ultimoAccesoDe(profesional.id)
                const estado = estadoDelAcceso(acceso)
                const delDia = jornadasDelDia.get(profesional.id)
                const jornada = delDia?.jornada
                const consultorio = profesional.moduloId ? nombreModulo(profesional.moduloId) : null

                return (
                  <tr
                    key={profesional.id}
                    tabIndex={0}
                    onClick={() => abrirGenerar(profesional)}
                    onKeyDown={(evento) => {
                      if (evento.key === 'Enter' || evento.key === ' ') {
                        evento.preventDefault()
                        abrirGenerar(profesional)
                      }
                    }}
                    aria-label={`Enlace de ${profesional.nombre}`}
                    className="cursor-pointer outline-none transition-colors duration-[var(--suave)] ease-[var(--curva)] hover:bg-acento-50/40 focus-visible:bg-acento-50/60"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${colorDeServicio(
                            profesional.servicioId,
                          )}`}
                        >
                          <User size={18} weight="fill" />
                        </span>
                        <div className="min-w-0 max-w-[15rem]">
                          <p
                            className="truncate font-semibold tracking-[-0.012em] text-brand-950"
                            title={profesional.nombre}
                          >
                            {profesional.nombre}
                          </p>
                          <p className="flex items-center gap-1.5 truncate text-xs font-medium text-slate-400">
                            <span className="shrink-0 text-slate-300">
                              {iconoDeServicio(nombreServicio(profesional.servicioId), 13)}
                            </span>
                            <span className="truncate">{nombreServicio(profesional.servicioId)}</span>
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {cargandoJornadas ? (
                        <span className="text-sm font-semibold text-slate-300">…</span>
                      ) : errorJornadas ? (
                        // Un fallo de la consulta no es una respuesta: con el
                        // mapa vacio, la tabla afirmaba fila por fila que ese
                        // dia no trabajaba nadie.
                        <Badge tone="amber">Sin dato</Badge>
                      ) : jornada ? (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-[0.015em] ring-1 ${
                            estiloJornada[jornada].chip
                          }`}
                        >
                          {iconoDeJornada(jornada, 13)}
                          {etiquetaJornada[jornada]}
                        </span>
                      ) : (
                        <Badge tone="slate">
                          {fecha > hoyEnColombia() ? 'Sin agenda' : 'No trabaja'}
                        </Badge>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {delDia?.desde && delDia.hasta ? (
                        <>
                          <p className="text-sm font-medium tabular-nums text-slate-700">
                            {enDoceHoras(delDia.desde)} – {enDoceHoras(delDia.hasta)}
                          </p>
                          <p className="text-xs font-medium text-slate-400">
                            {delDia.citas} {delDia.citas === 1 ? 'cita' : 'citas'}
                          </p>
                        </>
                      ) : (
                        // Sin agenda ese dia no hay horas que mostrar, pero si
                        // lo que SUELE hacer: es lo que deja calcular cuanto
                        // tiene que durar el enlace de quien entra a cubrir.
                        <span className="text-xs font-medium text-slate-400">
                          suele hacer {etiquetaJornada[profesional.jornada].toLowerCase()}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {consultorio ? (
                        <span
                          className="flex max-w-[13rem] items-center gap-1.5 text-slate-600"
                          title={consultorio}
                        >
                          <MapPin size={14} weight="fill" className="shrink-0 text-slate-300" />
                          <span className="truncate">{consultorio}</span>
                        </span>
                      ) : (
                        <span className="text-sm text-slate-300">Sin asignar</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-[0.015em] ring-1 ${estiloEstado[estado].chip}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 rounded-full ${estiloEstado[estado].punto}`}
                        />
                        {etiquetaEstado[estado]}
                      </span>
                      {acceso && estado === 'vigente' ? (
                        <p className="mt-1 text-xs font-medium tabular-nums text-slate-400">
                          {tiempoRestante(acceso.expiraEn)}
                        </p>
                      ) : null}
                    </td>

                    <td className="w-px whitespace-nowrap px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {/*
                          EL OJO SOLO SE ENCIENDE SI HAY ALGO QUE VER.

                          El servidor guarda el hash del token, nunca el enlace:
                          la unica copia en claro vive en la pestaña que lo
                          genero. Si el enlace se genero en otro equipo, o se
                          cerro la pestaña, no hay nada que volver a mostrar y
                          la unica salida es generar otro —que tumba el que el
                          doctor este usando—. Por eso el boton va apagado y lo
                          explica en su titulo: enterarse DESPUES de abrir es
                          enterarse tarde.
                        */}
                        <button
                          type="button"
                          disabled={estado !== 'vigente'}
                          onClick={(e) => {
                            e.stopPropagation()
                            abrirGenerar(profesional)
                          }}
                          title={
                            estado === 'vigente'
                              ? 'Ver el enlace vigente y volver a copiarlo, sin generar otro'
                              : 'Este doctor no tiene un enlace vigente que mostrar'
                          }
                          aria-label={`Ver el enlace de ${profesional.nombre}`}
                          className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200/70 text-slate-500 transition-colors duration-[var(--suave)] ease-[var(--curva)] hover:bg-acento-50 hover:text-acento-600 disabled:cursor-not-allowed disabled:border-slate-200/50 disabled:text-slate-300 disabled:hover:bg-transparent"
                        >
                          <Eye size={16} weight="bold" />
                        </button>

                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation()
                            abrirGenerar(profesional)
                          }}
                        >
                          <LinkIcon size={16} weight="bold" />
                          {estado === 'vigente' ? 'Regenerar' : 'Generar enlace'}
                        </Button>
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
        {recuperando ? (
          <div className="space-y-3 py-2" aria-busy="true">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-12 w-full" />
            <p className="text-sm text-slate-500">Buscando el enlace vigente de este profesional...</p>
          </div>
        ) : enlaceGenerado ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {enlaceEsNuevo
                ? 'Copialo y enviaselo al doctor ahora.'
                : 'Este es el enlace que el doctor tiene ahora mismo. Volver a copiarlo no lo cambia.'}
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
            <div className="flex items-center justify-between gap-2 pt-1">
              {accesoActivo ? (
                <Button
                  variant="danger"
                  onClick={() => setARevocar(accesoActivo)}
                  title="El doctor dejara de poder entrar con este enlace"
                >
                  <Prohibit size={16} weight="bold" />
                  Revocar
                </Button>
              ) : (
                <span />
              )}
              <Button variant="secondary" onClick={() => setProfesionalActivo(null)}>
                Listo
              </Button>
            </div>
          </div>
        ) : noSePudoRecuperar ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Este profesional tiene un enlace vigente, pero el sistema no pudo recuperarlo. Pasa con los
              enlaces generados antes de que se guardara una copia recuperable. Puedes generar uno nuevo,
              teniendo en cuenta que el anterior dejara de funcionar de inmediato: si el doctor esta
              atendiendo, hay que hacerle llegar el nuevo.
            </p>
            <div className="flex items-center justify-between gap-2 pt-2">
              {accesoActivo ? (
                <Button
                  variant="danger"
                  onClick={() => setARevocar(accesoActivo)}
                  title="El doctor dejara de poder entrar con este enlace"
                >
                  <Prohibit size={16} weight="bold" />
                  Revocar
                </Button>
              ) : (
                <span />
              )}
              <span className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setProfesionalActivo(null)}>
                  Cancelar
                </Button>
                <Button onClick={() => setNoSePudoRecuperar(false)}>Generar uno nuevo</Button>
              </span>
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

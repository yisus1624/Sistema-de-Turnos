'use client'

/**
 * Catalogo de profesionales (doctores).
 *
 * LOS DOCTORES NO SE CREAN AQUI: los trae la carga diaria del reporte del
 * hospital, que le abre la ficha a cada nombre que aparece en el archivo. Esta
 * pantalla es para CORREGIR esa ficha —el servicio, el consultorio, la jornada
 * habitual— y para desactivar a quien ya no atiende. Dar de alta uno a mano no
 * ayudaba y si hacia dano: el nombre tecleado casi nunca coincide letra por
 * letra con el del archivo, y en la siguiente carga el sistema no ve al mismo
 * doctor sino a dos, cada uno con la mitad de las citas.
 *
 * Dos reglas del dominio que esta pantalla hace cumplir:
 *
 * 1. Un doctor no se borra, se DESACTIVA: su nombre quedo escrito en los
 *    turnos que ya llamo y borrarlo dejaria ese rastro huerfano.
 * 2. Solo existe en servicios que atienden POR CITA. En los de ventanilla la
 *    fila es compartida y la toma quien este libre, asi que un doctor asignado
 *    ahi no tendria pacientes propios a quien llamar.
 *
 * LA LISTA ES LA DEL DIA, NO EL CATALOGO ENTERO. Esto es lo que cambio: antes
 * la tabla sacaba a todos los doctores registrados y a cada uno le ponia al
 * lado "no trabaja". Un dia sin agenda cargada se veia, entonces, como una
 * lista llena de doctores —veinte filas— cuando la respuesta correcta era que
 * hoy no atiende ninguno. El catalogo crece con cada carga y nunca se apaga
 * nada, asi que esa lista solo iba a ir a peor.
 *
 * Ahora la tabla arranca con los que ese dia TIENEN citas, y el catalogo
 * completo esta a un boton. No se esconde en silencio: el boton dice cuantos
 * quedan fuera, porque quien busca a un doctor concreto para editarlo tiene
 * que poder llegar a el aunque hoy no venga.
 *
 * El enlace con el que cada doctor entra a su consultorio NO se maneja aqui,
 * sino en "Enlaces de consultorio". Van separados a proposito: repartir
 * enlaces es trabajo del dia a dia y se le puede encargar al operador del
 * mostrador, mientras que tocar el catalogo (la jornada, sobre todo) le mueve
 * la agenda a todo el hospital.
 */

import { Paginacion, usePaginacion } from '@/components/ui/Paginacion'
import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { Icon } from '@phosphor-icons/react'
import {
  Broom,
  CalendarBlank,
  CalendarCheck,
  CalendarX,
  CaretLeft,
  CaretRight,
  Clock,
  Eye,
  EyeSlash,
  Faders,
  IdentificationCard,
  MagnifyingGlass,
  MapPin,
  MoonStars,
  Prohibit,
  Sun,
  User,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { TarjetaIndicador, TONOS_INDICADOR } from '@/components/ui/TarjetaIndicador'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Interruptor, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import { useFechaQueSigueAHoy, useUltimaPeticion, useValorConRetraso } from '@/lib/hooks'
import { diaVecino } from '@/lib/api/dia-elegido'
import { esFechaValida } from '@/lib/turnos/tiempo'
import type {
  Jornada,
  JornadaDelDia,
  Modulo,
  Profesional,
  Servicio,
} from '@/lib/turnos/types'

const COLUMNAS = ['Profesional', 'Especialidad', 'Jornada', 'Horario', 'Consultorio', 'Estado']

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
 * La jornada HABITUAL del doctor. Las horas concretas de cada una son las
 * mismas para todo el hospital y se configuran en "Pantalla y audio"; aqui
 * solo se elige en cual trabaja normalmente.
 *
 * NO ES LA JORNADA DE UN DIA. El mismo medico hace el lunes completo, el
 * martes solo la mañana y el miercoles no viene, y eso no cabe en un campo.
 * La de cada dia sale de las citas de ese dia y es la que manda en la tabla.
 * Esta solo decide a que horas se le puede agendar el PRIMER paciente de un
 * dia que todavia esta vacio; en cuanto tiene una cita, mandan sus citas.
 */
const etiquetaJornada: Record<Jornada, string> = {
  MANANA: 'Mañana',
  TARDE: 'Tarde',
  COMPLETA: 'Dia completo',
}

/**
 * Como se ve cada jornada.
 *
 * El sol y la luna no son adorno: la jornada se busca recorriendo la columna
 * de arriba abajo, y a ese ritmo la forma del icono se reconoce antes que la
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
 * Color del disco de cada doctor, por su servicio.
 *
 * Se asigna por posicion del servicio en el catalogo, no al azar, para que el
 * mismo doctor tenga siempre el mismo color: en una tabla larga, el color es
 * lo que deja ver de un golpe que tres filas seguidas son del mismo servicio.
 */
const COLORES_SERVICIO = [
  'bg-acento-50 text-acento-600',
  'bg-emerald-50 text-emerald-600',
  'bg-violet-50 text-violet-600',
  'bg-rose-50 text-rose-600',
  'bg-amber-50 text-amber-600',
  'bg-cyan-50 text-cyan-600',
]

/** "07:00" → "07:00 a. m.", que es como se dice y como se lee en el horario. */
function enDoceHoras(hhmm: string) {
  const [hora, minuto] = hhmm.split(':').map(Number)
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hora, minuto)))
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

  /**
   * El dia que se esta mirando.
   *
   * La tabla no es solo un catalogo: es tambien la respuesta a "¿que trabajo
   * este doctor el lunes?". Se puede mover a cualquier dia ya cargado, hacia
   * atras o hacia delante, porque la jornada de un dia sale de las citas de
   * ese dia y las citas no se borran.
   */
  const [fecha, setFecha] = useState(hoyEnColombia())
  // Si se estaba mirando hoy, pasa solo al dia siguiente a medianoche.
  useFechaQueSigueAHoy(setFecha)
  const [jornadasDelDia, setJornadasDelDia] = useState<Map<string, JornadaDelDia>>(new Map())
  const [cargandoJornadas, setCargandoJornadas] = useState(true)
  const [errorJornadas, setErrorJornadas] = useState(false)

  // Filtros de la tabla.
  const [busqueda, setBusqueda] = useState('')
  const [servicioFiltro, setServicioFiltro] = useState('')
  const [jornadaFiltro, setJornadaFiltro] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const busquedaDiferida = useValorConRetraso(busqueda, 250)

  /**
   * Si se muestra tambien a quien ese dia NO tiene agenda.
   *
   * Apagado a proposito: ver la cabecera del archivo. Se puede encender porque
   * editar la ficha de un doctor —o volver a activarlo— hay que poder hacerlo
   * cualquier dia, trabaje o no.
   */
  const [verSinAgenda, setVerSinAgenda] = useState(false)

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

  // Al pasar dias con las flechas, la respuesta lenta de un dia anterior no
  // puede pintar sus jornadas bajo la fecha nueva.
  const consultasDeJornadas = useUltimaPeticion()

  /** Lo que cada doctor trabajo el dia que se esta mirando. */
  const cargarJornadasDelDia = useCallback(async (dia: string) => {
    const consulta = consultasDeJornadas.iniciar()
    setCargandoJornadas(true)
    try {
      const { jornadas } = await pedir<{ jornadas: JornadaDelDia[] }>(
        `/api/turnos/profesionales/jornadas?fecha=${dia}`,
        { signal: consulta.signal },
      )
      if (!consulta.esVigente()) return
      setJornadasDelDia(new Map(jornadas.map((j) => [j.profesionalId, j])))
      setErrorJornadas(false)
    } catch (error) {
      if (!consulta.esVigente()) return
      toast.error('No se pudo cargar lo que trabajaron ese dia', mensajeDeError(error))
      // Se marca el error en vez de dejar el mapa vacio: vacio significa
      // "nadie trabajo", y eso seria afirmar algo que no se sabe.
      setJornadasDelDia(new Map())
      setErrorJornadas(true)
    } finally {
      if (consulta.esVigente()) setCargandoJornadas(false)
    }
  }, [consultasDeJornadas])

  useEffect(() => {
    cargar()
  }, [cargar])

  useEffect(() => {
    cargarJornadasDelDia(fecha)
  }, [cargarJornadasDelDia, fecha])

  const nombreServicio = useMemo(() => {
    const mapa = new Map(servicios.map((s) => [s.id, s.nombre]))
    return (id: string) => mapa.get(id) ?? '—'
  }, [servicios])

  const nombreModulo = useMemo(() => {
    const mapa = new Map(modulos.map((m) => [m.id, m.nombre]))
    return (id?: string | null) => (id ? (mapa.get(id) ?? null) : null)
  }, [modulos])

  /** El color del disco de un doctor, estable por servicio. */
  const colorDeServicio = useMemo(() => {
    const orden = new Map(servicios.map((servicio, indice) => [servicio.id, indice]))
    return (servicioId: string) =>
      COLORES_SERVICIO[(orden.get(servicioId) ?? 0) % COLORES_SERVICIO.length]
  }, [servicios])

  /** Un dia adelante o atras (ver `diaVecino`: nunca lanza con una fecha invalida). */
  const moverDia = useCallback((dias: number) => {
    setFecha((actual) => diaVecino(actual, dias))
  }, [])

  /**
   * Cuando la consulta del dia falla no se puede filtrar por agenda.
   *
   * El mapa vacio significaria "no trabaja nadie" y esconderia el catalogo
   * entero por un corte de red. Ante la duda se muestra todo y cada fila lo
   * dice en su columna.
   */
  const puedeFiltrarPorAgenda = !errorJornadas && !cargandoJornadas

  const tieneAgenda = useCallback(
    (profesional: Profesional) => Boolean(jornadasDelDia.get(profesional.id)?.jornada),
    [jornadasDelDia],
  )

  /** Las cuatro cifras de la cabecera, siempre sobre el catalogo completo. */
  const resumen = useMemo(() => {
    const conAgenda = profesionales.filter(tieneAgenda).length
    const inactivos = profesionales.filter((p) => !p.activo).length
    return {
      total: profesionales.length,
      conAgenda,
      // Activo pero hoy sin un solo paciente: existe en el hospital y no vino.
      sinAgenda: profesionales.filter((p) => p.activo && !tieneAgenda(p)).length,
      inactivos,
    }
  }, [profesionales, tieneAgenda])

  /** Cuantos quedan fuera por no tener agenda ese dia. */
  const ocultosSinAgenda = useMemo(
    () => (puedeFiltrarPorAgenda ? profesionales.filter((p) => !tieneAgenda(p)).length : 0),
    [profesionales, tieneAgenda, puedeFiltrarPorAgenda],
  )

  const filtrando =
    busquedaDiferida.trim() !== '' || servicioFiltro !== '' || jornadaFiltro !== '' || estadoFiltro !== ''

  const filtrados = useMemo(() => {
    const texto = busquedaDiferida.trim().toLowerCase()

    return profesionales.filter((profesional) => {
      const delDia = jornadasDelDia.get(profesional.id)

      if (puedeFiltrarPorAgenda && !verSinAgenda && !delDia?.jornada) return false
      if (servicioFiltro && profesional.servicioId !== servicioFiltro) return false
      if (jornadaFiltro && delDia?.jornada !== jornadaFiltro) return false
      if (estadoFiltro === 'activos' && !profesional.activo) return false
      if (estadoFiltro === 'inactivos' && profesional.activo) return false

      if (!texto) return true
      // Se busca tambien por servicio y consultorio: al mostrador le llega
      // "el de odontologia" o "el del consultorio 3" antes que el apellido.
      const donde = `${profesional.nombre} ${nombreServicio(profesional.servicioId)} ${
        nombreModulo(profesional.moduloId) ?? ''
      }`
      return donde.toLowerCase().includes(texto)
    })
  }, [
    profesionales,
    jornadasDelDia,
    puedeFiltrarPorAgenda,
    verSinAgenda,
    servicioFiltro,
    jornadaFiltro,
    estadoFiltro,
    busquedaDiferida,
    nombreServicio,
    nombreModulo,
  ])

  // Paginacion. El catalogo del hospital pasa de sesenta doctores y la tabla
  // entera de una vez obliga a recorrer la pagina con la rueda buscando un
  // apellido. Al cambiar el dia o un filtro, vuelve a la primera pagina.
  const pagina = usePaginacion(filtrados, [
    fecha,
    verSinAgenda,
    servicioFiltro,
    jornadaFiltro,
    estadoFiltro,
    busquedaDiferida,
  ])
  const visibles = pagina.visibles

  function limpiarFiltros() {
    setBusqueda('')
    setServicioFiltro('')
    setJornadaFiltro('')
    setEstadoFiltro('')
  }

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

  /**
   * Guarda los cambios de la ficha. SOLO EDITA, NO CREA.
   *
   * Los doctores entran solos con la carga del reporte del hospital: el archivo
   * trae el nombre y el sistema le abre la ficha. Dar de alta uno a mano aqui
   * no ayudaba y si hacia dano: el nombre tecleado casi nunca coincide letra
   * por letra con el del archivo, y cuando llega la carga el sistema no ve al
   * mismo doctor sino a dos, cada uno con sus citas.
   */
  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!editando) return

    setGuardando(true)
    try {
      await pedir(`/api/turnos/profesionales/${editando.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: formulario.nombre,
          servicioId: formulario.servicioId,
          jornada: formulario.jornada,
          moduloId: formulario.moduloId || null,
          activo: formulario.activo,
        }),
      })
      toast.success('Profesional actualizado', formulario.nombre)
      setAbierto(false)
      await cargar()
    } catch (error) {
      toast.error('No se pudo guardar', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  const esHoy = fecha === hoyEnColombia()

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaIndicador
          icono={UsersThree}
          etiqueta="Total"
          valor={resumen.total}
          detalle="Profesionales registrados"
          tono={TONOS_INDICADOR.acento}
        />
        <TarjetaIndicador
          icono={CalendarCheck}
          etiqueta="Con agenda"
          valor={resumen.conAgenda}
          detalle={esHoy ? 'Atienden hoy' : 'Atienden ese dia'}
          tono={TONOS_INDICADOR.verde}
        />
        <TarjetaIndicador
          icono={CalendarX}
          etiqueta="Sin agenda"
          valor={resumen.sinAgenda}
          detalle="Activos, sin citas ese dia"
          tono={TONOS_INDICADOR.ambar}
        />
        <TarjetaIndicador
          icono={Prohibit}
          etiqueta="Inactivos"
          valor={resumen.inactivos}
          detalle="No se les puede agendar"
          tono={TONOS_INDICADOR.rojo}
        />
      </div>

      <Card padded={false} className="mb-5 rounded-[1.375rem] p-4 md:px-5 md:py-4">
        <div className="flex flex-wrap items-center gap-3">
          {/*
            EL DIA MANDA SOBRE TODO LO DEMAS de esta pantalla: decide quien sale
            en la tabla, que jornada se le pone al lado y que horario. Por eso
            va el primero y con flechas, que es como se mueve de verdad —un dia
            adelante, un dia atras— sin abrir el calendario.
          */}
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-3">
            <CalendarBlank size={18} weight="bold" className="shrink-0 text-acento-500" />
            <input
              type="date"
              value={fecha}
              onChange={(e) => {
                // Vacio o con un año imposible mientras se corrige: se conserva la ultima fecha buena.
                if (esFechaValida(e.target.value)) setFecha(e.target.value)
              }}
              aria-label="Dia que se esta mirando"
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

          {!esHoy ? (
            <Button variant="secondary" onClick={() => setFecha(hoyEnColombia())}>
              <CalendarBlank size={17} weight="bold" />
              Hoy
            </Button>
          ) : null}

          {/*
            La busqueda se lleva el sitio que sobre, con un minimo por debajo
            del cual no baja: en una caja de 150px el texto que se acaba de
            teclear ya no se ve entero, y entonces no hay forma de saber si lo
            que no aparece es porque no existe o porque hay una errata.
          */}
          <div className="relative min-w-[15rem] flex-1">
            <MagnifyingGlass
              size={17}
              weight="bold"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Entrada
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value)
              }}
              placeholder="Buscar por nombre, especialidad o consultorio..."
              aria-label="Buscar profesional"
              className="pl-9"
            />
          </div>
        </div>

        {/*
          LOS FILTROS EN SU PROPIA FILA, Y CADA UNO CON EL ANCHO DE LO QUE DICE.

          Iban apretados junto al dia y a la busqueda, con un ancho maximo
          pensado a ojo, y el resultado era "Todos los estad…": un desplegable
          que no deja leer la opcion que tiene puesta no informa de nada, porque
          justo lo que hay que saber de un filtro es en que esta.

          Cada uno lleva ahora el ancho de su opcion mas larga, puesto en el
          contenedor y no en el campo: las clases base de `Seleccion` traen
          `w-full`, y sobrescribirlas desde fuera dependeria del orden en que
          Tailwind emita las dos reglas, que es una forma silenciosa de que el
          ancho quede al azar el dia de mañana.
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
              onChange={(e) => {
                setServicioFiltro(e.target.value)
              }}
              aria-label="Especialidad"
              className="pl-9"
            >
              <option value="">Todas las especialidades</option>
              {servicios.map((servicio) => (
                <option key={servicio.id} value={servicio.id}>
                  {servicio.nombre}
                </option>
              ))}
            </Seleccion>
          </div>

          <div className="w-full sm:w-[13rem]">
            <Seleccion
              value={jornadaFiltro}
              onChange={(e) => {
                setJornadaFiltro(e.target.value)
              }}
              aria-label="Jornada"
            >
              <option value="">Todas las jornadas</option>
              <option value="MANANA">{etiquetaJornada.MANANA}</option>
              <option value="TARDE">{etiquetaJornada.TARDE}</option>
              <option value="COMPLETA">{etiquetaJornada.COMPLETA}</option>
            </Seleccion>
          </div>

          <div className="w-full sm:w-[13rem]">
            <Seleccion
              value={estadoFiltro}
              onChange={(e) => {
                setEstadoFiltro(e.target.value)
              }}
              aria-label="Estado"
            >
              <option value="">Todos los estados</option>
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
            </Seleccion>
          </div>

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
              <IdentificationCard size={20} weight="fill" />
            </span>
            <div className="min-w-0">
              <CardTitle>Lista de profesionales ({filtrados.length})</CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                {verSinAgenda || !puedeFiltrarPorAgenda
                  ? 'Todo el catalogo, con lo que cada uno trabaja ese dia'
                  : 'Solo quienes tienen citas el dia seleccionado'}
              </p>
            </div>
          </div>

          {/*
            Los doctores sin agenda ese dia estan fuera, pero se dice cuantos
            son y se pueden traer. Esconderlos en silencio haria que quien
            busca a uno concreto creyera que no esta registrado y lo diera de
            alta otra vez, duplicando el catalogo.
          */}
          {ocultosSinAgenda > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setVerSinAgenda((antes) => !antes)
              }}
              aria-pressed={verSinAgenda}
              title={
                verSinAgenda
                  ? 'Dejar en la lista solo a los doctores que atienden ese dia'
                  : 'Traer a la lista los doctores que ese dia no tienen citas'
              }
            >
              {verSinAgenda ? (
                <EyeSlash size={16} weight="bold" className="text-slate-500" />
              ) : (
                <Eye size={16} weight="bold" className="text-slate-500" />
              )}
              {verSinAgenda ? 'Ocultar' : 'Mostrar'} {ocultosSinAgenda} sin agenda
            </Button>
          ) : null}
        </CardHeader>

        <CardContent padded={false}>
          {/*
            Se espera TAMBIEN a las jornadas del dia, no solo al catalogo.

            Es lo que decide que filas hay: pintando antes, la tabla aparecia
            con los veinte doctores del catalogo y medio segundo despues se
            quedaba en tres, o en ninguno. Ese salto se lee como un fallo, y
            quien va rapido alcanza a creerse la lista equivocada.
          */}
          {cargando || cargandoJornadas ? (
            <TablaSkeleton columnas={COLUMNAS} />
          ) : profesionales.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={IdentificationCard}
                title="Sin profesionales"
                description="Crea el primer doctor para poder agendarle citas."
              />
            </div>
          ) : filtrados.length === 0 ? (
            <div className="p-5">
              {/*
                EL VACIO TIENE DOS CAUSAS Y NO SE PARECEN EN NADA. O ese dia no
                atiende nadie —y entonces la respuesta correcta es justamente
                una lista vacia—, o los filtros son demasiado estrechos. Cada
                una lleva a una salida distinta, asi que se distinguen.
              */}
              <EmptyState
                icon={filtrando ? MagnifyingGlass : CalendarX}
                title={filtrando ? 'Ningun profesional coincide' : 'Ese dia no atiende nadie'}
                description={
                  filtrando
                    ? 'Prueba con otro nombre, otra especialidad o quita algun filtro.'
                    : 'No hay ni una cita cargada para esta fecha, asi que ningun doctor tiene jornada. Carga la agenda del dia en Citas, o mira el catalogo completo.'
                }
                action={
                  filtrando ? (
                    <Button variant="secondary" onClick={limpiarFiltros}>
                      Limpiar filtros
                    </Button>
                  ) : ocultosSinAgenda > 0 ? (
                    <Button variant="secondary" onClick={() => setVerSinAgenda(true)}>
                      <Eye size={16} weight="bold" className="text-slate-500" />
                      Ver el catalogo completo ({ocultosSinAgenda})
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <Tabla columnas={COLUMNAS}>
                {visibles.map((profesional) => {
                  const delDia = jornadasDelDia.get(profesional.id)
                  const consultorio = nombreModulo(profesional.moduloId)
                  const jornada = delDia?.jornada

                  return (
                    <tr
                      key={profesional.id}
                      tabIndex={0}
                      onClick={() => abrirEdicion(profesional)}
                      onKeyDown={(evento) => {
                        // La fila entera es el boton de editar —no hay columna
                        // de acciones—, asi que tiene que poder pulsarse
                        // tambien con el teclado o queda fuera del alcance de
                        // quien no usa raton.
                        if (evento.key === 'Enter' || evento.key === ' ') {
                          evento.preventDefault()
                          abrirEdicion(profesional)
                        }
                      }}
                      aria-label={`Editar ${profesional.nombre}`}
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
                          <div className="min-w-0">
                            <p className="truncate font-semibold tracking-[-0.012em] text-brand-950">
                              {profesional.nombre}
                            </p>
                            {/*
                              Debajo del nombre va la jornada HABITUAL, que es
                              el dato de su ficha. En la maqueta aqui se repetia
                              la especialidad, que ya tiene su propia columna al
                              lado; asi el hueco dice algo que no esta en
                              ninguna otra parte de la fila.
                            */}
                            <p className="truncate text-xs font-medium text-slate-400">
                              Habitual: {etiquetaJornada[profesional.jornada].toLowerCase()}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {nombreServicio(profesional.servicioId)}
                      </td>

                      <td className="px-4 py-3">
                        {/* Sin rama de "cargando": mientras las jornadas del
                            dia estan en camino, la tabla entera es el esqueleto
                            de arriba y aqui no se llega. */}
                        {errorJornadas ? (
                          // UN FALLO DE LA CONSULTA NO ES UNA RESPUESTA. Con el
                          // mapa vacio, la ausencia se pintaba como "no
                          // trabaja": ante un corte de red la tabla afirmaba,
                          // fila por fila, que ese dia no vino nadie.
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
                              <span className="whitespace-nowrap">{enDoceHoras(delDia.desde)}</span> –{' '}
                              <span className="whitespace-nowrap">{enDoceHoras(delDia.hasta)}</span>
                            </p>
                            <p className="text-xs font-medium text-slate-400">
                              {delDia.citas} {delDia.citas === 1 ? 'cita' : 'citas'}
                            </p>
                          </>
                        ) : (
                          <span className="text-sm text-slate-300">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {consultorio ? (
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <MapPin size={14} weight="fill" className="shrink-0 text-slate-300" />
                            {consultorio}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">Sin asignar</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-[0.015em] ring-1 ${
                            profesional.activo
                              ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                              : 'bg-rose-50 text-rose-700 ring-rose-100'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full ${
                              profesional.activo ? 'bg-emerald-500' : 'bg-rose-500'
                            }`}
                          />
                          {profesional.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </Tabla>

              <Paginacion {...pagina} />
            </>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-sm leading-6 text-slate-500">
        <strong className="font-semibold text-slate-600">Jornada</strong> y{' '}
        <strong className="font-semibold text-slate-600">horario</strong> son lo que dicen las citas
        del dia seleccionado; la jornada habitual de la ficha solo decide a que horas se le agenda el
        primer paciente de un dia vacio, y la carga del reporte la reajusta sola. El enlace con el
        que cada doctor entra a su consultorio se genera en{' '}
        <strong className="font-semibold text-slate-600">Enlaces de consultorio</strong>.
      </p>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title="Editar profesional"
        description="Los doctores entran solos con la carga del reporte; aqui se corrige su ficha."
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

            <Campo etiqueta="Jornada habitual" ayuda="Solo decide a que horas se le agenda el primer paciente de un dia vacio.">
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
                <p className="text-sm font-semibold text-slate-800">Activo</p>
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
              Guardar cambios
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

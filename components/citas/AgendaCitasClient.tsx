'use client'

/**
 * Horario de citas del dia.
 *
 * La comparten dos pantallas, con el mismo comportamiento: `/admin/citas`
 * (administrador) y `/operador/agenda` (operador). Por eso vive aqui y no
 * dentro de la carpeta de un rol.
 *
 * POR QUE UNA PARRILLA Y NO UNA LISTA. En el hospital unos doctores atienden
 * en la mañana y otros en la tarde. La pregunta que se hace el que agenda no es
 * "que citas hay" sino "como va este doctor": una parrilla de doctor x hora la
 * responde de un vistazo y, sobre todo, deja ver el error caro, que es citar
 * dos pacientes con el mismo doctor a la misma hora.
 *
 * LAS FILAS SALEN DE LAS CITAS, NO DE UNA REJILLA FIJA. Antes las horas eran
 * las franjas de la configuracion (7:00, 7:10, 7:20...) y lo que no caia justo
 * ahi se mandaba a una lista al pie. Con la agenda real del hospital eso
 * vaciaba columnas enteras: sus citas vienen a las 7:09 y a las 7:13, cada
 * doctor con su ritmo —uno cada diez minutos, otro cada trece, uno con treinta
 * pacientes y otro con veintisiete—, y ese ritmo no lo decide este sistema.
 * Ahora cada cita cae en su hora de verdad; las franjas configuradas siguen
 * apareciendo, pero solo como los huecos donde se puede agendar A MANO.
 *
 * La parrilla la arma el SERVIDOR (`horarioDelDia`), porque depende de la
 * configuracion del hospital, de la jornada de cada doctor y de sus citas.
 * Aqui solo se pinta y se piden los cambios.
 *
 * El documento y el nombre completo del paciente solo se manejan en esta
 * pantalla CON sesion; nunca salen hacia la pantalla de la sala de espera.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarBlank,
  CalendarPlus,
  MagnifyingGlass,
  Plus,
  Minus,
  Sun,
  Warning,
  MoonStars,
  Eye,
  EyeSlash,
  CaretDown,
} from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { Skeleton } from '@/components/ui/Loader'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Seleccion } from '@/components/admin/Campos'
import CargarReporteCitas from './CargarReporteCitas'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import { useValorConRetraso } from '@/lib/hooks'
import type { BloqueHorario, CitaEnHorario, EstadoCita, HorarioDia } from '@/lib/turnos/types'

/**
 * Instante ISO de una franja del dia EN COLOMBIA.
 *
 * El desfase va escrito a mano (-05:00) y no se usa la zona del navegador: es
 * la misma razon que en el servidor. Colombia no tiene horario de verano, y un
 * equipo configurado en otra zona agendaria la cita en el dia equivocado.
 */
function instanteDeFranja(fecha: string, hora: string) {
  return new Date(`${fecha}T${hora}:00-05:00`).toISOString()
}

/** "11/09, 09:00" — para mostrar de donde venia una cita que se movio. */
function fechaYHora(iso: string) {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

/** Como se ve cada estado dentro de la parrilla. */
const estilosEstado: Record<
  EstadoCita,
  { celda: string; etiqueta: string; tono: 'blue' | 'amber' | 'green' | 'slate' }
> = {
  PROGRAMADA: {
    celda: 'border-brand-200 bg-brand-50 text-brand-900 hover:bg-brand-100',
    etiqueta: 'Programada',
    tono: 'blue',
  },
  PRESENTADO: {
    celda: 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200',
    etiqueta: 'Ya llego',
    tono: 'amber',
  },
  ATENDIDA: {
    celda: 'border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200',
    etiqueta: 'Atendida',
    tono: 'green',
  },
  // No deberia pintarse nunca: el servidor no manda canceladas al horario.
  CANCELADA: {
    celda: 'border-slate-200 bg-slate-100 text-slate-500',
    etiqueta: 'Cancelada',
    tono: 'slate',
  },
}

/**
 * Color del encabezado de cada columna segun el servicio.
 *
 * Sirve para leer la parrilla por bloques ("esta parte es odontologia") cuando
 * hay muchos doctores. El color se asigna por posicion del servicio dentro del
 * bloque, no al azar, para que no cambie entre recargas.
 */
const COLORES_SERVICIO = [
  'bg-brand-700',
  'bg-emerald-600',
  'bg-amber-500',
  'bg-violet-600',
  'bg-rose-500',
  'bg-cyan-600',
]

type Jornada = 'MANANA' | 'TARDE'

/**
 * La jornada que se esta viviendo ahora mismo en Colombia.
 *
 * Con las dos parrillas desplegadas a la vez, la de la tarde empieza mas abajo
 * del borde de la pantalla y la de la mañana solo se ve por la mitad: hay que
 * desplazarse dos veces para mirar una agenda. En el mostrador se trabaja sobre
 * UNA jornada durante horas —la de la mañana hasta el almuerzo, la de la tarde
 * despues—, asi que se abre esa y la otra queda plegada a un clic.
 *
 * El corte es a la una, el mismo que usa el servidor para repartir a los
 * doctores entre las dos jornadas.
 */
function jornadaDeAhora(): Jornada {
  const hora = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'America/Bogota',
    }).format(new Date()),
  )
  return hora < 13 ? 'MANANA' : 'TARDE'
}

type CeldaSeleccionada = { profesionalId: string; profesionalNombre: string; hora: string }

export default function AgendaCitasClient() {
  const [fecha, setFecha] = useState(hoyEnColombia)
  const [horario, setHorario] = useState<HorarioDia | null>(null)
  const [cargando, setCargando] = useState(true)

  // Filtros de la parrilla. Con pocos doctores sobran, pero el hospital puede
  // llegar a tener veinte o treinta en una jornada, y entonces buscar una
  // columna a punta de desplazamiento lateral es inviable.
  const [busqueda, setBusqueda] = useState('')
  const [servicioFiltro, setServicioFiltro] = useState('')
  const busquedaDiferida = useValorConRetraso(busqueda, 250)

  /**
   * Si se muestran tambien los doctores que hoy NO tienen ni una cita.
   *
   * Apagado a proposito. El catalogo de doctores lo va llenando la carga diaria
   * y crece con el tiempo, pero en un dia cualquiera atiende una parte: con
   * todos en la parrilla, la mayoria de las columnas quedan vacias y encontrar
   * la del doctor que se busca es recorrer la pantalla de lado leyendo nombres.
   * Peor aun, esas columnas vacias se ven exactamente igual que la del doctor
   * que si atiende y todavia no tiene pacientes, asi que no informan de nada.
   *
   * Se puede encender, porque para agendarle el primer paciente del dia a un
   * doctor hay que poder llegar a su columna.
   */
  const [verSinCitas, setVerSinCitas] = useState(false)

  /**
   * Jornadas desplegadas. Arranca con la que corresponde a la hora.
   *
   * Se guardan las abiertas y no "la abierta" porque plegar las dos, o abrir
   * las dos para comparar a un doctor de dia completo, son cosas que se hacen;
   * forzar que siempre haya exactamente una abierta quitaria las dos.
   */
  const [jornadasAbiertas, setJornadasAbiertas] = useState<Jornada[]>(() => [jornadaDeAhora()])

  // Alta de cita sobre una franja libre.
  const [celda, setCelda] = useState<CeldaSeleccionada | null>(null)
  const [documento, setDocumento] = useState('')
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Detalle de una cita ya agendada.
  const [detalle, setDetalle] = useState<CitaEnHorario | null>(null)
  const [aCancelar, setACancelar] = useState<CitaEnHorario | null>(null)
  const [cancelando, setCancelando] = useState(false)
  const [motivoCancelar, setMotivoCancelar] = useState('')

  // Reprogramacion: mover la cita conservando el mismo registro. El destino
  // puede ser otro dia, asi que la parrilla del dia destino se pide aparte,
  // sin tocar la que se esta viendo.
  const [aReprogramar, setAReprogramar] = useState<CitaEnHorario | null>(null)
  const [destinoFecha, setDestinoFecha] = useState('')
  const [destinoProfesional, setDestinoProfesional] = useState('')
  const [destinoHora, setDestinoHora] = useState('')
  const [motivoReprogramar, setMotivoReprogramar] = useState('')
  const [horarioDestino, setHorarioDestino] = useState<HorarioDia | null>(null)
  const [cargandoDestino, setCargandoDestino] = useState(false)
  const [reprogramando, setReprogramando] = useState(false)

  /**
   * Ultimo dia que se pidio. Sirve para descartar la respuesta de una consulta
   * que el operador ya reemplazo al cambiar de fecha (mismo patron que la
   * parrilla del dia destino, mas abajo).
   *
   * Sin esto, pasar dias rapido dejaba la parrilla de un dia pintada mientras
   * el selector marcaba otro: la respuesta mas lenta llegaba la ultima y
   * ganaba. El operador veia entonces los cupos libres de un dia y agendaba en
   * OTRO, porque la cita se crea con la fecha del selector. El servidor no deja
   * pisar un cupo ocupado, asi que no se llegaba a duplicar un paciente, pero
   * si a citar a alguien un dia que nadie miro.
   */
  const diaPedidoRef = useRef('')

  const cargar = useCallback(async (dia: string) => {
    diaPedidoRef.current = dia
    setCargando(true)
    try {
      const { horario: datos } = await pedir<{ horario: HorarioDia }>(
        `/api/turnos/agenda/horario?fecha=${dia}`,
      )
      if (diaPedidoRef.current !== dia) return
      setHorario(datos)
    } catch (error) {
      if (diaPedidoRef.current !== dia) return
      toast.error('No se pudo cargar el horario', mensajeDeError(error))
      setHorario(null)
    } finally {
      // Solo la consulta vigente apaga el indicador: si lo apagara una que
      // llego tarde, la pantalla diria "listo" con la siguiente aun en camino.
      if (diaPedidoRef.current === dia) setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar(fecha)
  }, [cargar, fecha])

  /**
   * Al cambiar de dia se vuelve a la jornada que toca por la hora.
   *
   * Cambiar de fecha es empezar a mirar otra cosa, y arrastrar ahi lo que se
   * hubiera plegado para el dia anterior deja la pantalla en un estado que
   * nadie pidio. En un dia que no es hoy la hora no dice nada, asi que se abre
   * la mañana, que es por donde se empieza a leer una agenda.
   */
  useEffect(() => {
    setJornadasAbiertas([fecha === hoyEnColombia() ? jornadaDeAhora() : 'MANANA'])
  }, [fecha])

  /**
   * Servicios presentes hoy, para el selector.
   *
   * Salen de las columnas que la parrilla llega a mostrar, no del catalogo: un
   * servicio cuyos doctores hoy no atienden dejaria la parrilla en blanco al
   * elegirlo, y el operador pensaria que se rompio algo.
   */
  const servicios = useMemo(() => {
    const nombres =
      horario?.bloques.flatMap((b) =>
        b.columnas.filter((c) => verSinCitas || c.citas > 0).map((c) => c.servicioNombre),
      ) ?? []
    return [...new Set(nombres)].sort((a, b) => a.localeCompare(b, 'es'))
  }, [horario, verSinCitas])

  const filtrando = busquedaDiferida.trim() !== '' || servicioFiltro !== ''
  // Un dia que ya paso se consulta, pero no se agenda: el servidor tambien lo
  // rechaza, y ofrecer el boton solo lleva al operador a un error evitable.
  const esPasado = fecha < hoyEnColombia()

  /**
   * La parrilla con solo las columnas que pasan el filtro.
   *
   * Se filtran COLUMNAS, nunca franjas ni citas: las celdas se buscan por
   * `profesionalId|hora`, asi que esconder un doctor no descoloca a los demas.
   */
  const bloquesVisibles = useMemo(() => {
    if (!horario) return []
    const texto = busquedaDiferida.trim().toLowerCase()

    return horario.bloques.map((bloque) => ({
      ...bloque,
      columnas: bloque.columnas.filter((columna) => {
        // El doctor que hoy no atiende no ocupa sitio en la parrilla.
        if (!verSinCitas && columna.citas === 0) return false
        if (servicioFiltro && columna.servicioNombre !== servicioFiltro) return false
        if (!texto) return true
        // Se busca tambien por consultorio: el operador muchas veces sabe
        // "es el de odontologia" antes que el apellido del doctor.
        return `${columna.profesionalNombre} ${columna.moduloNombre ?? ''}`.toLowerCase().includes(texto)
      }),
    }))
  }, [horario, busquedaDiferida, servicioFiltro, verSinCitas])

  /** Doctores que la parrilla puede llegar a mostrar: el universo de la busqueda. */
  const doctoresTotales = useMemo(
    () =>
      new Set(
        horario?.bloques.flatMap((b) =>
          b.columnas.filter((c) => verSinCitas || c.citas > 0).map((c) => c.profesionalId),
        ) ?? [],
      ).size,
    [horario, verSinCitas],
  )
  const doctoresVisibles = useMemo(
    () => new Set(bloquesVisibles.flatMap((b) => b.columnas.map((c) => c.profesionalId))).size,
    [bloquesVisibles],
  )

  /**
   * Columnas escondidas por no tener ninguna cita.
   *
   * Se cuentan COLUMNAS y no doctores, y la diferencia se ve: el medico de dia
   * completo que hoy solo tiene pacientes por la mañana sigue en la parrilla,
   * pero su columna de la tarde no esta. Contando doctores, el aviso decia "8
   * ocultos" justo al lado de "14 de 14 doctores", y las dos cosas eran
   * ciertas: por eso ahora se nombra lo que de verdad se escondio.
   */
  const columnasOcultas = useMemo(() => {
    let ocultas = 0
    for (const bloque of horario?.bloques ?? []) {
      for (const columna of bloque.columnas) {
        if (columna.citas === 0) ocultas += 1
      }
    }
    return ocultas
  }, [horario])

  /**
   * Cuantas citas hay hoy en las columnas QUE SE VEN.
   *
   * Ya no se dice "64 de 546 cupos ocupados". Ese 546 salia de partir la
   * jornada entre la duracion de la consulta, y era un numero inventado: cada
   * doctor lleva su propio ritmo y su propia cantidad de pacientes, eso lo
   * decide la agenda del hospital. Lo que se puede afirmar es cuantas citas
   * hay, y es lo que se muestra.
   */
  const totalCitas = useMemo(
    () => bloquesVisibles.reduce((total, b) => total + b.columnas.reduce((s, c) => s + c.citas, 0), 0),
    [bloquesVisibles],
  )

  const abrirNueva = useCallback((profesionalId: string, profesionalNombre: string, hora: string) => {
    setCelda({ profesionalId, profesionalNombre, hora })
    setDocumento('')
    setNombre('')
  }, [])

  // Estables a proposito: la parrilla esta memoizada y una funcion nueva en
  // cada render la haria repintarse entera sin que nada haya cambiado.
  const mostrarSinCitas = useCallback(() => setVerSinCitas(true), [])

  const alternarJornada = useCallback((jornada: Jornada) => {
    setJornadasAbiertas((abiertas) =>
      abiertas.includes(jornada) ? abiertas.filter((j) => j !== jornada) : [...abiertas, jornada],
    )
  }, [])

  async function agendar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!celda) return

    setGuardando(true)
    try {
      await pedir('/api/turnos/agenda', {
        method: 'POST',
        body: JSON.stringify({
          documentoPaciente: documento,
          nombrePaciente: nombre,
          profesionalId: celda.profesionalId,
          horaCita: instanteDeFranja(fecha, celda.hora),
        }),
      })
      toast.success('Cita agendada', `${nombre} a las ${celda.hora} con ${celda.profesionalNombre}.`)
      setCelda(null)
      await cargar(fecha)
    } catch (error) {
      toast.error('No se pudo agendar', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  async function confirmarCancelar() {
    if (!aCancelar) return
    setCancelando(true)
    try {
      // El motivo viaja con la cancelacion. Es opcional para no trancar al
      // mostrador, pero el servidor graba siempre quien y cuando: antes
      // cancelar no dejaba ningun rastro y no habia como responderle al
      // paciente que venia a reclamar.
      await pedir(`/api/turnos/agenda/${aCancelar.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ motivo: motivoCancelar }),
      })
      toast.info('Cita cancelada', `${aCancelar.nombrePaciente}, ${aCancelar.hora}.`)
      setACancelar(null)
      setMotivoCancelar('')
      setDetalle(null)
      await cargar(fecha)
    } catch (error) {
      toast.error('No se pudo cancelar', mensajeDeError(error))
    } finally {
      setCancelando(false)
    }
  }

  /** Abre el formulario de reprogramacion partiendo del dia que se esta viendo. */
  function abrirReprogramar(cita: CitaEnHorario) {
    setAReprogramar(cita)
    setDestinoFecha(fecha)
    setDestinoProfesional(cita.profesionalId)
    setDestinoHora('')
    setMotivoReprogramar('')
    setHorarioDestino(null)
  }

  // La parrilla del dia destino, para ofrecer solo cupos que de verdad existen
  // y estan libres. Se pide aparte de la que se esta viendo porque lo normal es
  // mover al paciente a OTRO dia.
  useEffect(() => {
    if (!aReprogramar || !destinoFecha) return

    let vigente = true
    setCargandoDestino(true)

    pedir<{ horario: HorarioDia }>(`/api/turnos/agenda/horario?fecha=${destinoFecha}`)
      .then(({ horario: datos }) => {
        if (!vigente) return
        setHorarioDestino(datos)

        // El doctor que traia la cita puede no atender el dia destino (jornada
        // distinta, o simplemente no trabaja ese dia). Si se dejara puesto, el
        // desplegable se veria en blanco y la lista de horas vacia sin que se
        // entienda por que.
        const atiendeEseDia = datos.bloques.some((bloque) =>
          bloque.columnas.some((columna) => columna.profesionalId === destinoProfesional),
        )
        if (!atiendeEseDia) {
          setDestinoProfesional('')
          setDestinoHora('')
        }
      })
      .catch((error) => {
        if (vigente) {
          setHorarioDestino(null)
          toast.error('No se pudo cargar ese dia', mensajeDeError(error))
        }
      })
      .finally(() => {
        if (vigente) setCargandoDestino(false)
      })

    return () => {
      vigente = false
    }
  }, [aReprogramar, destinoFecha])

  /** Doctores que atienden el dia destino, sin repetir entre jornadas. */
  const doctoresDestino = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const bloque of horarioDestino?.bloques ?? []) {
      for (const columna of bloque.columnas) mapa.set(columna.profesionalId, columna.profesionalNombre)
    }
    return [...mapa.entries()].map(([id, nombre]) => ({ id, nombre }))
  }, [horarioDestino])

  /**
   * Horas libres del doctor elegido ese dia.
   *
   * La cita que se esta moviendo NO cuenta como ocupante de su propio cupo: si
   * no, su hora actual aparecia ocupada y no se podia, por ejemplo, dejarle la
   * hora y cambiarle solo de doctor.
   */
  const horasDestino = useMemo(() => {
    if (!horarioDestino || !destinoProfesional) return []

    const libres: string[] = []
    for (const bloque of horarioDestino.bloques) {
      if (!bloque.columnas.some((c) => c.profesionalId === destinoProfesional)) continue
      for (const fila of bloque.filas) {
        // Solo franjas de la configuracion: mover a alguien a las 7:09 porque
        // otro doctor tiene una cita a esa hora lo rechaza el servidor.
        if (!fila.agendable) continue
        const ocupantes = bloque.citas[`${destinoProfesional}|${fila.hora}`] ?? []
        const libre = ocupantes.every((c) => c.id === aReprogramar?.id)
        if (libre) libres.push(fila.hora)
      }
    }
    return libres
  }, [horarioDestino, destinoProfesional, aReprogramar])

  async function confirmarReprogramar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!aReprogramar || !destinoHora) return

    setReprogramando(true)
    try {
      await pedir(`/api/turnos/agenda/${aReprogramar.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          horaCita: instanteDeFranja(destinoFecha, destinoHora),
          profesionalId: destinoProfesional,
          motivo: motivoReprogramar,
        }),
      })
      toast.success(
        'Cita reprogramada',
        `${aReprogramar.nombrePaciente}: ${destinoFecha} a las ${destinoHora}.`,
      )
      setAReprogramar(null)
      setDetalle(null)
      await cargar(fecha)
    } catch (error) {
      toast.error('No se pudo reprogramar', mensajeDeError(error))
    } finally {
      setReprogramando(false)
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Campo etiqueta="Fecha" className="w-44">
              <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Campo>
            <Button
              variant="secondary"
              onClick={() => setFecha(hoyEnColombia())}
              disabled={fecha === hoyEnColombia()}
            >
              <CalendarBlank size={17} weight="bold" />
              Hoy
            </Button>

            {/*
              La agenda del dia no se teclea: la trae el reporte del hospital.
              El boton vive junto al selector de fecha porque es lo primero que
              se hace al abrir, antes de mirar la parrilla.
            */}
            <CargarReporteCitas alTerminar={() => cargar(fecha)} />
          </div>

          {horario ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-baseline gap-1.5 rounded-xl bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-800">
                <strong className="text-base font-semibold leading-none text-brand-900">{totalCitas}</strong>
                citas agendadas
              </span>
              <span className="inline-flex items-center rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500">
                Franjas cada {horario.duracionCitaMinutos} min
              </span>

              {/*
                Los doctores sin agenda hoy estan escondidos, pero se dice
                cuantos son y se pueden traer: esconderlos en silencio haria
                que quien busca a uno concreto creyera que no esta registrado
                y lo diera de alta otra vez, duplicando el catalogo.

                Es un boton de verdad y no un enlace subrayado: enciende y
                apaga algo de la pantalla, y con el estado escrito dentro del
                boton se ve de un vistazo si la parrilla esta completa.
              */}
              {columnasOcultas > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setVerSinCitas((antes) => !antes)}
                  aria-pressed={verSinCitas}
                  title={
                    verSinCitas
                      ? 'Dejar en la parrilla solo a los doctores con pacientes hoy'
                      : 'Traer a la parrilla los doctores que hoy no tienen ninguna cita'
                  }
                >
                  {verSinCitas ? (
                    <EyeSlash size={16} weight="bold" className="text-slate-500" />
                  ) : (
                    <Eye size={16} weight="bold" className="text-slate-500" />
                  )}
                  {verSinCitas ? 'Ocultar' : 'Mostrar'} {columnasOcultas} sin citas
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/*
          El filtro solo aparece cuando de verdad hace falta. Con cuatro
          doctores estorba; con veinte es la unica forma practica de llegar a
          la columna que se busca sin recorrer la parrilla de lado.
        */}
        {horario && doctoresTotales > 6 ? (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            <Campo etiqueta="Buscar doctor o consultorio" className="w-full max-w-xs">
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

            {servicios.length > 1 ? (
              <Campo etiqueta="Servicio" className="w-full max-w-[220px]">
                <Seleccion value={servicioFiltro} onChange={(e) => setServicioFiltro(e.target.value)}>
                  <option value="">Todos</option>
                  {servicios.map((servicio) => (
                    <option key={servicio} value={servicio}>
                      {servicio}
                    </option>
                  ))}
                </Seleccion>
              </Campo>
            ) : null}

            <div className="flex items-center gap-3 pb-0.5">
              <span className="text-sm font-bold text-slate-500">
                {doctoresVisibles} de {doctoresTotales} doctores
              </span>
              {filtrando ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setBusqueda('')
                    setServicioFiltro('')
                  }}
                >
                  Ver todos
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      {cargando ? (
        <div className="space-y-5" aria-busy="true" aria-label="Cargando el horario">
          {[0, 1].map((bloque) => (
            <Card key={bloque} padded={false}>
              <CardHeader>
                <Skeleton className="h-5 w-56" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !horario ? null : (
        <div className="space-y-5">
          {esPasado ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <Warning size={20} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                Este dia ya paso: la agenda se puede consultar, pero no se pueden agendar citas. Una cita en
                una fecha pasada no la va a registrar nadie en admisiones y solo ensucia la agenda.
              </span>
            </div>
          ) : null}

          {bloquesVisibles.map((bloque) => (
            <Parrilla
              key={bloque.jornada}
              bloque={bloque}
              filtrando={filtrando}
              ocultandoSinCitas={!verSinCitas && columnasOcultas > 0}
              onMostrarSinCitas={mostrarSinCitas}
              abierta={jornadasAbiertas.includes(bloque.jornada)}
              // Con una sola jornada desplegada la parrilla se estira: es justo
              // el sitio que deja libre la que esta plegada.
              aSolas={jornadasAbiertas.length === 1}
              onAlternar={alternarJornada}
              soloLectura={esPasado}
              onLibre={abrirNueva}
              onOcupada={setDetalle}
            />
          ))}

          <FueraDeHorario citas={horario.fueraDeHorario} onCita={setDetalle} />

          <Leyenda />
        </div>
      )}

      {/* --- Alta de cita sobre la franja elegida --- */}
      <Modal
        open={!!celda}
        onClose={() => setCelda(null)}
        title="Nueva cita"
        description={
          celda ? `${celda.profesionalNombre} · ${fecha} a las ${celda.hora}` : undefined
        }
      >
        <form onSubmit={agendar} className="space-y-4">
          <Campo etiqueta="Documento del paciente">
            <Entrada
              inputMode="numeric"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              placeholder="1067890123"
              required
              minLength={4}
              autoFocus
            />
          </Campo>

          <Campo etiqueta="Nombre del paciente">
            <Entrada
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Juan Carlos Perez"
              required
              minLength={3}
            />
          </Campo>

          <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
            El turno no se genera todavia: sale cuando el paciente llegue y se registre su llegada en{' '}
            <strong className="font-semibold">Registro de llegada</strong>.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setCelda(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={guardando}>
              Agendar cita
            </Button>
          </div>
        </form>
      </Modal>

      {/* --- Detalle de una cita ya agendada --- */}
      <Modal
        open={!!detalle}
        onClose={() => setDetalle(null)}
        title={detalle?.nombrePaciente ?? ''}
        description={detalle ? `Cita de las ${detalle.hora}` : undefined}
      >
        {detalle ? (
          <div className="space-y-4">
            <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm font-bold text-slate-500">Documento</dt>
                <dd className="tabular-nums font-semibold text-brand-950">{detalle.documentoPaciente}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm font-bold text-slate-500">Hora</dt>
                <dd className="tabular-nums font-semibold text-brand-950">{detalle.hora}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm font-bold text-slate-500">Estado</dt>
                <dd>
                  <Badge tone={estilosEstado[detalle.estado].tono}>
                    {estilosEstado[detalle.estado].etiqueta}
                  </Badge>
                </dd>
              </div>
              {/* Solo aparece si la cita se ha movido: para una cita normal
                  seria ruido, y para una que ya lleva tres cambios es el dato
                  que quien la vuelve a mover tiene que ver antes. */}
              {detalle.vecesReprogramada ? (
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-sm font-bold text-slate-500">Reprogramada</dt>
                  <dd className="text-right">
                    <span className="font-semibold text-amber-700">
                      {detalle.vecesReprogramada}{' '}
                      {detalle.vecesReprogramada === 1 ? 'vez' : 'veces'}
                    </span>
                    {detalle.horaCitaOriginal ? (
                      <span className="mt-0.5 block text-xs font-semibold text-slate-500">
                        Originalmente: {fechaYHora(detalle.horaCitaOriginal)}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
            </dl>

            {detalle.estado === 'PROGRAMADA' ? (
              <p className="text-sm leading-6 text-slate-600">
                Todavia no ha llegado. Si se cancela, la franja queda libre para otro paciente.
              </p>
            ) : (
              <p className="text-sm leading-6 text-slate-600">
                El paciente ya registro su llegada, asi que la cita no se puede cancelar: su turno ya esta
                en la fila del doctor.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setDetalle(null)}>
                Cerrar
              </Button>
              {detalle.estado === 'PROGRAMADA' ? (
                <>
                  {/*
                    Reprogramar es lo primero que hay que ofrecer: hasta ahora,
                    mover a un paciente obligaba a cancelar y volver a crear la
                    cita, y eso dejaba dos registros sueltos sin nada que dijera
                    que eran el mismo paciente reubicado.
                  */}
                  <Button onClick={() => abrirReprogramar(detalle)}>Reprogramar</Button>
                  <Button variant="danger" onClick={() => setACancelar(detalle)}>
                    Cancelar cita
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* --- Reprogramar: mover la cita sin perderle el rastro --- */}
      <Modal
        open={!!aReprogramar}
        onClose={() => setAReprogramar(null)}
        title="Reprogramar la cita"
        description={
          aReprogramar
            ? `${aReprogramar.nombrePaciente} · ahora esta a las ${aReprogramar.hora}`
            : undefined
        }
      >
        <form onSubmit={confirmarReprogramar} className="space-y-4">
          {aReprogramar?.vecesReprogramada ? (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <Warning size={18} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                A este paciente ya le movieron la cita {aReprogramar.vecesReprogramada}{' '}
                {aReprogramar.vecesReprogramada === 1 ? 'vez' : 'veces'}.
              </span>
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Nueva fecha">
              <Entrada
                type="date"
                value={destinoFecha}
                min={hoyEnColombia()}
                onChange={(e) => {
                  setDestinoFecha(e.target.value)
                  setDestinoHora('')
                }}
                required
              />
            </Campo>

            <Campo etiqueta="Doctor">
              <Seleccion
                value={destinoProfesional}
                onChange={(e) => {
                  setDestinoProfesional(e.target.value)
                  setDestinoHora('')
                }}
                required
              >
                <option value="">Elige el doctor</option>
                {doctoresDestino.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          </div>

          {/* Solo cupos que existen y estan libres ese dia: reprogramar pasa por
              las mismas reglas de la parrilla que agendar de nuevo. */}
          <Campo
            etiqueta="Nueva hora"
            ayuda={
              cargandoDestino
                ? 'Buscando cupos libres...'
                : destinoProfesional && horasDestino.length === 0
                  ? 'Ese doctor no tiene cupos libres ese dia. Prueba con otra fecha u otro doctor.'
                  : undefined
            }
          >
            <Seleccion
              value={destinoHora}
              onChange={(e) => setDestinoHora(e.target.value)}
              disabled={cargandoDestino || horasDestino.length === 0}
              required
            >
              <option value="">Elige la hora</option>
              {horasDestino.map((hora) => (
                <option key={hora} value={hora}>
                  {hora}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Motivo" ayuda="Opcional, pero es lo que explica el cambio si el paciente reclama.">
            <Entrada
              value={motivoReprogramar}
              onChange={(e) => setMotivoReprogramar(e.target.value)}
              placeholder="El doctor esta incapacitado"
              maxLength={200}
            />
          </Campo>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAReprogramar(null)}>
              Cerrar
            </Button>
            <Button type="submit" loading={reprogramando} disabled={!destinoHora}>
              Reprogramar
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!aCancelar}
        onClose={() => {
          setACancelar(null)
          setMotivoCancelar('')
        }}
        onConfirm={confirmarCancelar}
        loading={cancelando}
        title="Cancelar esta cita"
        description={
          aCancelar
            ? `Se libera la franja de las ${aCancelar.hora} y ${aCancelar.nombrePaciente} deja de aparecer en la agenda del doctor.`
            : undefined
        }
        confirmLabel="Cancelar cita"
        danger
      >
        <div className="space-y-3">
          <p className="text-sm leading-6 text-slate-600">
            Si el paciente sigue necesitando la cita, es mejor{' '}
            <strong className="font-semibold">reprogramarla</strong>: asi se conserva su historial en vez de
            quedar una cita cancelada y otra nueva sin relacion entre ellas.
          </p>
          <Campo etiqueta="Motivo" ayuda="Queda guardado junto con quien cancela y a que hora.">
            <Entrada
              value={motivoCancelar}
              onChange={(e) => setMotivoCancelar(e.target.value)}
              placeholder="El paciente aviso que no puede venir"
              maxLength={200}
            />
          </Campo>
        </div>
      </ConfirmModal>
    </>
  )
}

/**
 * La parrilla de una jornada: filas de hora por columnas de doctor.
 *
 * COMO AGUANTA MUCHOS DOCTORES. La parrilla vive dentro de su propia ventana
 * con desplazamiento en los dos ejes, y los encabezados quedan congelados: la
 * fila de doctores arriba y la columna de horas a la izquierda. Sin eso, a
 * partir de unas diez filas se pierde de vista de quien es cada columna y se
 * termina contando columnas con el dedo para no equivocarse de doctor, que en
 * una agenda de citas es un error caro.
 */
const Parrilla = memo(function Parrilla({
  bloque,
  filtrando,
  ocultandoSinCitas,
  onMostrarSinCitas,
  abierta,
  aSolas,
  onAlternar,
  soloLectura,
  onLibre,
  onOcupada,
}: {
  bloque: BloqueHorario
  filtrando: boolean
  /** Se estan escondiendo los doctores que no tienen citas en esta jornada. */
  ocultandoSinCitas: boolean
  /** Trae a la parrilla los doctores sin citas, desde la jornada vacia. */
  onMostrarSinCitas: () => void
  /** Jornada desplegada: plegada solo se ve el encabezado con su resumen. */
  abierta: boolean
  /** Es la unica jornada desplegada, asi que la parrilla puede ocupar mas alto. */
  aSolas: boolean
  onAlternar: (jornada: 'MANANA' | 'TARDE') => void
  /** Dia ya pasado: se consulta, no se agenda. */
  soloLectura: boolean
  onLibre: (profesionalId: string, profesionalNombre: string, hora: string) => void
  onOcupada: (cita: CitaEnHorario) => void
}) {
  const Icono = bloque.jornada === 'MANANA' ? Sun : MoonStars

  // Un color por servicio, estable dentro del bloque.
  const colorDeServicio = useMemo(() => {
    const servicios = [...new Set(bloque.columnas.map((c) => c.servicioNombre))]
    return (nombre: string) => COLORES_SERVICIO[servicios.indexOf(nombre) % COLORES_SERVICIO.length]
  }, [bloque.columnas])

  // Se cuentan SOLO las columnas visibles: si no, al filtrar por servicio el
  // encabezado mostraba cosas como "30 citas" sobre una parrilla con tres.
  const agendadas = bloque.columnas.reduce((suma, c) => suma + c.citas, 0)

  return (
    <Card padded={false}>
      {/*
        Todo el encabezado es el boton de plegar, no un icono pequeño en una
        esquina: es un blanco grande, y plegar y desplegar jornadas es lo que
        mas se hace en esta pantalla a lo largo del dia.

        El titulo va en un `span` y no en `CardTitle`: dentro de un boton solo
        puede ir contenido de linea, y un encabezado ahi es HTML invalido.
      */}
      <button
        type="button"
        onClick={() => onAlternar(bloque.jornada)}
        aria-expanded={abierta}
        className={`flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-slate-50 ${
          abierta ? 'border-b border-slate-100' : ''
        }`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
              bloque.jornada === 'MANANA' ? 'bg-amber-100 text-amber-700' : 'bg-brand-50 text-brand-700'
            }`}
          >
            <Icono size={17} weight="fill" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold tracking-[-0.02em] text-brand-950">
              {bloque.etiqueta}
            </span>
            <span className="block text-xs font-semibold text-slate-500">
              {bloque.desde} a {bloque.hasta} · {bloque.columnas.length} doctor(es)
              {filtrando ? ' que coinciden con el filtro' : ''}
            </span>
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2.5">
          {/* El conteo se queda tambien plegada: es lo que deja decidir si hace
              falta abrirla. */}
          <span className="rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-medium tabular-nums text-slate-600">
            {agendadas} citas
          </span>
          <span className="text-xs font-bold text-slate-500">{abierta ? 'Ocultar' : 'Mostrar'}</span>
          <CaretDown
            size={16}
            weight="bold"
            className={`text-slate-400 transition-transform ${abierta ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {/*
        Plegada no se pinta: una parrilla de treinta columnas por cuarenta
        filas son mas de mil celdas, y tenerlas montadas para no verlas hace
        lento cada cambio de la pantalla.
      */}
      {!abierta ? null : (
      <CardContent padded={false}>
        {bloque.columnas.length === 0 || bloque.filas.length === 0 ? (
          // Vacio COMPACTO, no el cartel de pantalla entera: aqui la jornada
          // vacia es una tarjeta entre otras, y un bloque de casi 300px de
          // alto empujaba la jornada siguiente fuera de la pantalla sin decir
          // nada mas. Y cuando la salida es traer a los doctores sin citas, el
          // boton esta aqui mismo y no arriba.
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center sm:flex-row sm:gap-4 sm:text-left">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400">
              <CalendarPlus size={20} weight="duotone" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-brand-950">
                {bloque.filas.length === 0
                  ? 'Jornada sin franjas'
                  : filtrando
                    ? 'Ningun doctor coincide'
                    : ocultandoSinCitas
                      ? 'Nadie tiene citas en esta jornada'
                      : 'Sin doctores en esta jornada'}
              </p>
              <p className="mt-0.5 text-sm leading-6 text-slate-500">
                {bloque.filas.length === 0
                  ? 'Las horas configuradas para esta jornada no dejan espacio para ninguna consulta. Revisalas en Pantalla y audio.'
                  : filtrando
                    ? 'En esta jornada no hay doctores que coincidan con lo que buscas. Prueba con otro nombre o quita el filtro.'
                    : ocultandoSinCitas
                      ? 'Ningun doctor tiene pacientes agendados aqui. Para agendar el primero, trae a los doctores sin citas.'
                      : 'Ningun doctor activo atiende en esta jornada. Asignale la jornada a un doctor en Profesionales.'}
              </p>
            </div>
            {bloque.filas.length > 0 && !filtrando && ocultandoSinCitas ? (
              <Button variant="secondary" size="sm" className="shrink-0" onClick={onMostrarSinCitas}>
                <Eye size={16} weight="bold" className="text-slate-500" />
                Mostrar doctores sin citas
              </Button>
            ) : null}
          </div>
        ) : (
          // Ventana propia con desplazamiento en los dos ejes: la fila de
          // doctores queda congelada arriba y la columna de horas a la
          // izquierda, como en una hoja de calculo. El alto se limita para que
          // los encabezados tengan contra que quedarse fijos.
          <div className={`overflow-auto ${aSolas ? 'max-h-[calc(100dvh-13rem)]' : 'max-h-[70vh]'}`}>
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {/* La esquina se cruza con las dos barras congeladas, asi
                      que va por encima de ambas. */}
                  <th className="sticky left-0 top-0 z-30 w-20 border-b border-slate-200 bg-slate-100 px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-600">
                    Hora
                  </th>
                  {bloque.columnas.map((columna) => (
                    <th
                      key={columna.profesionalId}
                      className={`sticky top-0 z-20 min-w-[186px] border-b border-l border-white/20 px-3 py-2 text-left text-white ${colorDeServicio(
                        columna.servicioNombre,
                      )}`}
                    >
                      <span className="block truncate text-sm font-semibold leading-tight">
                        {columna.profesionalNombre}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] font-semibold leading-tight text-white/80">
                        {columna.moduloNombre ? `${columna.moduloNombre} · ` : ''}
                        {columna.servicioNombre} · {columna.citas} citas
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bloque.filas.map((fila) => (
                  <tr key={fila.hora}>
                    <th
                      scope="row"
                      className={`sticky left-0 z-10 border-b border-slate-100 px-3 py-1.5 text-left text-sm font-semibold tabular-nums ${
                        // La hora que no es franja de la configuracion se marca
                        // mas suave: esta ahi porque alguien tiene cita a esa
                        // hora, no porque se pueda agendar en ella.
                        fila.agendable ? 'bg-slate-50 text-slate-600' : 'bg-white text-slate-400'
                      }`}
                    >
                      {fila.hora}
                    </th>
                    {bloque.columnas.map((columna) => {
                      const citas = bloque.citas[`${columna.profesionalId}|${fila.hora}`]

                      return (
                        <td
                          key={columna.profesionalId}
                          className="border-b border-l border-slate-100 p-1 align-top"
                        >
                          {citas?.length ? (
                            // Puede haber mas de una: el hospital a veces cita a
                            // dos pacientes con el mismo doctor a la misma hora.
                            // Se ven las dos; esconder una seria perder a alguien
                            // que igual se presenta.
                            <div className="space-y-1">
                              {citas.map((cita) => (
                                <button
                                  key={cita.id}
                                  type="button"
                                  onClick={() => onOcupada(cita)}
                                  className={`w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${
                                    estilosEstado[cita.estado].celda
                                  }`}
                                  title={`${cita.nombrePaciente} · ${estilosEstado[cita.estado].etiqueta}`}
                                >
                                  <span className="line-clamp-2 block whitespace-normal text-sm font-semibold leading-snug">
                                    {cita.nombrePaciente}
                                  </span>
                                  <span className="mt-0.5 block truncate text-xs font-semibold opacity-70">
                                    {estilosEstado[cita.estado].etiqueta}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : soloLectura || !fila.agendable ? (
                            // Dia pasado, u hora que no es franja de consulta: la
                            // celda se ve para no descuadrar la fila, pero no se
                            // ofrece agendar ahi porque el servidor lo rechaza.
                            <div
                              className="flex w-full items-center justify-center rounded-lg border border-dashed border-slate-100 px-2 py-2.5 text-slate-200"
                              aria-hidden="true"
                            >
                              <Minus size={14} weight="bold" />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                onLibre(columna.profesionalId, columna.profesionalNombre, fila.hora)
                              }
                              className="flex w-full items-center justify-center rounded-lg border border-dashed border-slate-200 px-2 py-2.5 text-slate-300 transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600"
                              title={`Agendar a las ${fila.hora} con ${columna.profesionalNombre}`}
                              aria-label={`Agendar a las ${fila.hora} con ${columna.profesionalNombre}`}
                            >
                              <Plus size={14} weight="bold" />
                            </button>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      )}
    </Card>
  )
})

/**
 * Citas del dia que no tienen columna donde caer.
 *
 * Ya no son las que "no encajan en la rejilla" —eso lo arreglo que las filas
 * salgan de las propias citas—, sino las del doctor que no esta en la parrilla:
 * se le dio de baja, o se le paso a un servicio de ventanilla, despues de
 * haberle agendado. No se esconden: un paciente que desaparece de la agenda
 * igual se presenta en el hospital.
 */
function FueraDeHorario({
  citas,
  onCita,
}: {
  citas: CitaEnHorario[]
  onCita: (cita: CitaEnHorario) => void
}) {
  if (citas.length === 0) return null

  return (
    <Card padded={false}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
            <Warning size={20} weight="fill" />
          </span>
          <div className="min-w-0">
            <CardTitle>Citas sin doctor en la parrilla ({citas.length})</CardTitle>
            <p className="text-xs font-bold text-slate-500">
              Su doctor ya no aparece en la agenda del dia: esta inactivo o cambio a un servicio que
              atiende por orden de llegada. Reasignalas a otro doctor.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {citas.map((cita) => (
          <button
            key={cita.id}
            type="button"
            onClick={() => onCita(cita)}
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left transition-colors hover:bg-amber-100"
          >
            <span className="block text-xs font-medium text-amber-900">
              {cita.hora} · {cita.nombrePaciente}
            </span>
            <span className="block text-[11px] font-semibold text-amber-700">
              {estilosEstado[cita.estado].etiqueta}
            </span>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

function Leyenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs font-bold text-slate-500">
      <span className="flex items-center gap-2">
        <span className="h-3 w-3 rounded border border-dashed border-slate-300" />
        Hora libre para agendar
      </span>
      {(['PROGRAMADA', 'PRESENTADO', 'ATENDIDA'] as const).map((estado) => (
        <span key={estado} className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded border ${estilosEstado[estado].celda}`} />
          {estilosEstado[estado].etiqueta}
        </span>
      ))}
    </div>
  )
}

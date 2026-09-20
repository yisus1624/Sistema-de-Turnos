'use client'

/**
 * Horario de citas del dia.
 *
 * La comparten dos pantallas, con el mismo comportamiento: `/admin/citas`
 * (administrador) y `/operador/agenda` (operador). Por eso vive aqui y no
 * dentro de la carpeta de un rol.
 *
 * UNA COLUMNA POR DOCTOR, UNA JORNADA A LA VEZ. La pregunta que se hace el que
 * agenda no es "que citas hay" sino "como va este doctor", asi que la pantalla
 * son tarjetas —una por doctor— con sus pacientes seguidos en orden de hora, y
 * arriba dos pestañas para elegir la jornada que se esta trabajando.
 *
 * LAS HORAS SALEN DE LAS CITAS, NO DE UNA REJILLA FIJA. Antes las horas eran
 * las franjas de la configuracion (7:00, 7:10, 7:20...) y lo que no caia justo
 * ahi se mandaba a una lista al pie. Con la agenda real del hospital eso
 * vaciaba columnas enteras: sus citas vienen a las 7:09 y a las 7:13, cada
 * doctor con su ritmo —uno cada diez minutos, otro cada trece, uno con treinta
 * pacientes y otro con veintisiete—, y ese ritmo no lo decide este sistema.
 * Ahora cada cita cae en su hora de verdad; las franjas configuradas siguen
 * apareciendo, pero solo como los huecos donde se puede agendar A MANO.
 *
 * El horario lo arma el SERVIDOR (`horarioDelDia`), porque depende de la
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
  Faders,
  MagnifyingGlass,
  MapPin,
  Plus,
  Sun,
  User,
  Warning,
  MoonStars,
  Eye,
  EyeSlash,
  CaretDown,
  CaretLeft,
  CaretRight,
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
import type {
  BloqueHorario,
  CitaEnHorario,
  ColumnaHorario,
  EstadoCita,
  FilaHorario,
  HorarioDia,
} from '@/lib/turnos/types'

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

/** "14 de abril de 2025" — el dia escrito, que es como se dice en voz alta. */
function fechaLarga(fecha: string) {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(new Date(`${fecha}T12:00:00-05:00`))
}

/** Como se ve cada estado dentro de la agenda. */
const estilosEstado: Record<
  EstadoCita,
  {
    /**
     * La franja de color de la fila de la cita, dentro de la tarjeta del doctor.
     *
     * EL COLOR VA EN UNA FRANJA A LA IZQUIERDA, no en el fondo entero. La
     * tarjeta es una lista de horas seguidas, y con cada fila pintada de su
     * color de punta a punta la columna se volvia un semaforo donde ya no se
     * leia ni el nombre del paciente ni la hora. La franja da el estado de
     * reojo y deja el fondo en paz para lo que de verdad hay que leer.
     */
    barra: string
    /**
     * El resto de la fila: un tinte muy claro del mismo color de la franja.
     *
     * Es el tono mas palido de la escala, casi blanco. Suficiente para que la
     * fila se agrupe con su franja y para que una columna de citas se lea como
     * una secuencia de estados sin tener que ir leyendo etiqueta por etiqueta;
     * no tanto como para que el nombre del paciente pierda contraste.
     */
    fila: string
    etiqueta: string
    tono: 'acento' | 'amber' | 'green' | 'slate'
  }
> = {
  PROGRAMADA: {
    barra: 'bg-acento-500',
    fila: 'border-acento-100/70 bg-acento-50/40 hover:border-acento-200 hover:bg-acento-50',
    etiqueta: 'Programada',
    tono: 'acento',
  },
  PRESENTADO: {
    barra: 'bg-amber-400',
    fila: 'border-amber-100 bg-amber-50/40 hover:border-amber-200 hover:bg-amber-50',
    etiqueta: 'Ya llego',
    tono: 'amber',
  },
  ATENDIDA: {
    barra: 'bg-emerald-500',
    fila: 'border-emerald-100 bg-emerald-50/40 hover:border-emerald-200 hover:bg-emerald-50',
    etiqueta: 'Atendida',
    tono: 'green',
  },
  // No deberia pintarse nunca: el servidor no manda canceladas al horario.
  CANCELADA: {
    barra: 'bg-slate-300',
    fila: 'border-slate-200 bg-slate-50 hover:bg-slate-100',
    etiqueta: 'Cancelada',
    tono: 'slate',
  },
}

/**
 * Color de cada servicio, para el distintivo de la tarjeta del doctor.
 *
 * Sirve para leer la pantalla por bloques ("estas son las de odontologia")
 * cuando hay muchas tarjetas. El color se asigna por posicion del servicio
 * dentro de la jornada, no al azar, para que no cambie entre recargas.
 *
 * SON TONOS PASTEL, NO COLORES PLENOS. Antes el encabezado de cada columna iba
 * pintado a saturacion completa y la pantalla parecia una caja de lapices: seis
 * bloques de color gritando a la vez, y encima el color del servicio pesaba mas
 * que el estado de las citas, que es lo unico que de verdad hay que mirar. El
 * distintivo solo tiene que dejar agrupar de reojo, asi que va en un disco
 * suave con el icono en el tono fuerte: se distingue sin competir.
 */
const COLORES_SERVICIO = [
  'bg-acento-50 text-acento-600',
  'bg-emerald-50 text-emerald-600',
  'bg-amber-50 text-amber-600',
  'bg-violet-50 text-violet-600',
  'bg-rose-50 text-rose-600',
  'bg-cyan-50 text-cyan-600',
]

type Jornada = 'MANANA' | 'TARDE'

/**
 * La jornada que se esta viviendo ahora mismo en Colombia.
 *
 * Es con la que abre la pantalla. En el mostrador se trabaja sobre UNA jornada
 * durante horas —la de la mañana hasta el almuerzo, la de la tarde despues—,
 * asi que llegar con esa ya puesta ahorra el primer clic del dia, todos los
 * dias.
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
   * La jornada que se esta mirando. Arranca con la que corresponde a la hora.
   *
   * ES UNA SOLA, Y ESO ES EL CAMBIO. Antes las dos jornadas se apilaban una
   * debajo de la otra y se plegaban a mano: la de la tarde empezaba fuera del
   * borde de la pantalla y habia que desplazarse dos veces para mirar una
   * agenda. En el mostrador se trabaja sobre UNA jornada durante horas —la de
   * la mañana hasta el almuerzo, la de la tarde despues—, asi que la pantalla
   * muestra esa entera y la otra queda a un clic en la pestaña de al lado.
   */
  const [jornadaActiva, setJornadaActiva] = useState<Jornada>(jornadaDeAhora)

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
   * Cambiar de fecha es empezar a mirar otra cosa, y arrastrar ahi la pestaña
   * que se hubiera elegido para el dia anterior deja la pantalla en un estado
   * que nadie pidio. En un dia que no es hoy la hora no dice nada, asi que se
   * abre la mañana, que es por donde se empieza a leer una agenda.
   */
  useEffect(() => {
    setJornadaActiva(fecha === hoyEnColombia() ? jornadaDeAhora() : 'MANANA')
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

  /**
   * Un dia adelante o atras.
   *
   * Se calcula sobre la fecha en texto y a mediodia UTC, no con `new Date()`
   * del navegador: partiendo de medianoche, un equipo configurado en otra zona
   * saltaria dos dias o ninguno al sumar uno.
   */
  const moverDia = useCallback((dias: number) => {
    setFecha((actual) => {
      const dia = new Date(`${actual}T12:00:00Z`)
      dia.setUTCDate(dia.getUTCDate() + dias)
      return dia.toISOString().slice(0, 10)
    })
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
      <Card padded={false} className="mb-5 rounded-[1.375rem] p-4 md:px-5 md:py-4">
        <div className="flex flex-wrap items-center gap-3">
          {/*
            EL DIA SE NAVEGA, NO SOLO SE TECLEA.

            Lo que mas se hace es moverse un dia adelante o atras —"¿y mañana
            como va?"—, y eso con un selector de fecha son tres gestos: abrir
            el calendario, buscar el numero y pulsarlo. Las flechas lo dejan en
            uno. El selector se queda al lado para los saltos largos.
          */}
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-3">
            <CalendarBlank size={18} weight="bold" className="shrink-0 text-acento-500" />
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              aria-label="Dia de la agenda"
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
            se hace al abrir, antes de mirar la agenda.
          */}
          <CargarReporteCitas alTerminar={() => cargar(fecha)} />

          {/*
            El filtro solo aparece cuando de verdad hace falta. Con cuatro
            doctores estorba; con veinte es la unica forma practica de llegar a
            la tarjeta que se busca sin recorrer la pantalla entera.
          */}
          {horario && doctoresTotales > 6 ? (
            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              <div className="relative w-full max-w-xs">
                <MagnifyingGlass
                  size={17}
                  weight="bold"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <Entrada
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por medico o consultorio..."
                  aria-label="Buscar doctor o consultorio"
                  className="pl-9"
                />
              </div>

              {servicios.length > 1 ? (
                <div className="relative w-full max-w-[230px]">
                  <Faders
                    size={17}
                    weight="bold"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <Seleccion
                    value={servicioFiltro}
                    onChange={(e) => setServicioFiltro(e.target.value)}
                    aria-label="Servicio"
                    className="pl-9"
                  >
                    <option value="">Todos los servicios</option>
                    {servicios.map((servicio) => (
                      <option key={servicio} value={servicio}>
                        {servicio}
                      </option>
                    ))}
                  </Seleccion>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {horario ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3.5">
            <span className="text-sm font-semibold capitalize tracking-[-0.012em] text-brand-950">
              {fechaLarga(fecha)}
            </span>
            <span className="h-3.5 w-px bg-slate-200" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-500">
              {totalCitas} {totalCitas === 1 ? 'cita agendada' : 'citas agendadas'}
              {doctoresTotales > 6 ? ` · ${doctoresVisibles} de ${doctoresTotales} doctores` : ''}
            </span>

            <span className="ml-auto flex flex-wrap items-center gap-2.5">
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

              {/*
                Los doctores sin agenda hoy estan escondidos, pero se dice
                cuantos son y se pueden traer: esconderlos en silencio haria
                que quien busca a uno concreto creyera que no esta registrado
                y lo diera de alta otra vez, duplicando el catalogo.
              */}
              {columnasOcultas > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setVerSinCitas((antes) => !antes)}
                  aria-pressed={verSinCitas}
                  title={
                    verSinCitas
                      ? 'Dejar en la agenda solo a los doctores con pacientes hoy'
                      : 'Traer a la agenda los doctores que hoy no tienen ninguna cita'
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
            </span>
          </div>
        ) : null}
      </Card>

      {cargando ? (
        <div className="space-y-5" aria-busy="true" aria-label="Cargando el horario">
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-[4.5rem] w-full rounded-[1.25rem]" />
            <Skeleton className="h-[4.5rem] w-full rounded-[1.25rem]" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {[0, 1, 2, 3].map((tarjeta) => (
              <Card key={tarjeta} padded={false} className="rounded-[1.375rem]">
                <CardHeader>
                  <Skeleton className="h-9 w-44" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
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

          {/*
            LAS DOS JORNADAS SON DOS PESTAÑAS, NO DOS LISTAS APILADAS.

            Se mira una jornada a la vez y durante horas, asi que la que toca
            se lleva la pantalla entera y la otra espera aqui arriba con su
            horario y su cuenta de citas escritos: se ve lo que hay al otro
            lado sin tener que cambiar para averiguarlo.
          */}
          <div role="tablist" aria-label="Jornada" className="grid gap-3 sm:grid-cols-2">
            {horario.bloques.map((bloque) => {
              const activa = bloque.jornada === jornadaActiva
              const Icono = bloque.jornada === 'MANANA' ? Sun : MoonStars
              const citasDeLaJornada =
                bloquesVisibles
                  .find((visible) => visible.jornada === bloque.jornada)
                  ?.columnas.reduce((suma, columna) => suma + columna.citas, 0) ?? 0

              return (
                <button
                  key={bloque.jornada}
                  id={`jornada-${bloque.jornada}`}
                  type="button"
                  role="tab"
                  aria-selected={activa}
                  aria-controls="jornada-agenda"
                  onClick={() => setJornadaActiva(bloque.jornada)}
                  className={`flex items-center gap-3.5 rounded-[1.375rem] border px-5 py-4 text-left transition-colors duration-[var(--suave)] ease-[var(--curva)] active:scale-[.99] active:transition-transform active:duration-[var(--toque)] ${
                    activa
                      ? /*
                          La pestaña encendida es una superficie de color con
                          una caida minima de arriba a abajo. Es lo mismo que
                          hace la seccion activa del menu, y por la misma razon:
                          aqui las sombras en botones estan desactivadas, asi
                          que el relieve tiene que salir del propio color.
                        */
                        'border-acento-600 bg-gradient-to-b from-acento-500 to-acento-600 text-white'
                      : 'border-slate-200/60 bg-white text-slate-600 hover:border-acento-200 hover:bg-acento-50/40'
                  }`}
                >
                  <span
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
                      activa
                        ? 'bg-white/15 text-white'
                        : bloque.jornada === 'MANANA'
                          ? 'bg-amber-50 text-amber-500'
                          : 'bg-acento-50 text-acento-500'
                    }`}
                  >
                    <Icono size={20} weight="fill" />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-[15px] font-semibold leading-tight tracking-[-0.02em] ${
                        activa ? 'text-white' : 'text-brand-950'
                      }`}
                    >
                      {bloque.etiqueta}
                    </span>
                    <span
                      className={`mt-1 block truncate text-xs font-medium leading-tight tabular-nums ${
                        activa ? 'text-white/75' : 'text-slate-500'
                      }`}
                    >
                      {bloque.desde} a {bloque.hasta} · {citasDeLaJornada}{' '}
                      {citasDeLaJornada === 1 ? 'cita' : 'citas'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div id="jornada-agenda" role="tabpanel" aria-labelledby={`jornada-${jornadaActiva}`}>
            <JornadaEnColumnas
              bloque={bloquesVisibles.find((bloque) => bloque.jornada === jornadaActiva) ?? null}
              filtrando={filtrando}
              ocultandoSinCitas={!verSinCitas && columnasOcultas > 0}
              onMostrarSinCitas={mostrarSinCitas}
              soloLectura={esPasado}
              onLibre={abrirNueva}
              onOcupada={setDetalle}
            />
          </div>

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
 * La jornada entera, en una tarjeta por doctor.
 *
 * POR QUE COLUMNAS Y NO UNA PARRILLA. Antes esto era una hoja de calculo:
 * filas de hora por columnas de doctor, con desplazamiento en los dos ejes.
 * Respondia bien a "quien esta libre a las 9:15", pero esa no es la pregunta
 * del mostrador. La pregunta es "como va este doctor", y en la parrilla eso se
 * contestaba leyendo una columna estrecha de arriba abajo mientras el resto de
 * la pantalla empujaba la vista de lado; con quince doctores, la mayoria de la
 * parrilla eran celdas vacias que solo servian para cuadrar la rejilla.
 *
 * Cada doctor tiene ahora su tarjeta con sus pacientes seguidos, en orden de
 * hora. Lo que se lee es una agenda, que es lo que es. Las tarjetas fluyen en
 * varias columnas y se reparten solas segun el ancho de la pantalla, asi que
 * ya no hay desplazamiento lateral: los doctores que no caben siguen debajo.
 *
 * LAS HORAS LIBRES NO SE PIERDEN. Agendar a mano sigue siendo cosa de esta
 * pantalla, asi que cada tarjeta guarda sus franjas libres al pie, plegadas:
 * no compiten con los pacientes del dia, pero estan a un clic.
 */
function JornadaEnColumnas({
  bloque,
  filtrando,
  ocultandoSinCitas,
  onMostrarSinCitas,
  soloLectura,
  onLibre,
  onOcupada,
}: {
  /** La jornada elegida, ya filtrada. `null` si el dia no la trae. */
  bloque: BloqueHorario | null
  filtrando: boolean
  /** Se estan escondiendo los doctores que no tienen citas en esta jornada. */
  ocultandoSinCitas: boolean
  /** Trae a la agenda los doctores sin citas, desde la jornada vacia. */
  onMostrarSinCitas: () => void
  /** Dia ya pasado: se consulta, no se agenda. */
  soloLectura: boolean
  onLibre: (profesionalId: string, profesionalNombre: string, hora: string) => void
  onOcupada: (cita: CitaEnHorario) => void
}) {
  // Un color por servicio, estable dentro de la jornada: sirve para leer la
  // pantalla por bloques ("estas son las de odontologia") cuando hay muchas
  // tarjetas. Se asigna por posicion del servicio, no al azar, para que no
  // cambie entre recargas.
  const colorDeServicio = useMemo(() => {
    const servicios = [...new Set(bloque?.columnas.map((columna) => columna.servicioNombre) ?? [])]
    return (nombre: string) => COLORES_SERVICIO[servicios.indexOf(nombre) % COLORES_SERVICIO.length]
  }, [bloque])

  if (!bloque || bloque.columnas.length === 0 || bloque.filas.length === 0) {
    const sinFranjas = !bloque || bloque.filas.length === 0

    return (
      <Card className="rounded-[1.375rem]">
        <div className="flex flex-col items-center gap-3 px-1 py-6 text-center sm:flex-row sm:gap-4 sm:text-left">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400">
            <CalendarPlus size={22} weight="duotone" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-950">
              {sinFranjas
                ? 'Jornada sin franjas'
                : filtrando
                  ? 'Ningun doctor coincide'
                  : ocultandoSinCitas
                    ? 'Nadie tiene citas en esta jornada'
                    : 'Sin doctores en esta jornada'}
            </p>
            <p className="mt-0.5 text-sm leading-6 text-slate-500">
              {sinFranjas
                ? 'Las horas configuradas para esta jornada no dejan espacio para ninguna consulta. Revisalas en Pantalla y audio.'
                : filtrando
                  ? 'En esta jornada no hay doctores que coincidan con lo que buscas. Prueba con otro nombre o quita el filtro.'
                  : ocultandoSinCitas
                    ? 'Ningun doctor tiene pacientes agendados aqui. Para agendar el primero, trae a los doctores sin citas.'
                    : 'Ningun doctor activo atiende en esta jornada. Asignale la jornada a un doctor en Profesionales.'}
            </p>
          </div>
          {!sinFranjas && !filtrando && ocultandoSinCitas ? (
            <Button variant="secondary" size="sm" className="shrink-0" onClick={onMostrarSinCitas}>
              <Eye size={16} weight="bold" className="text-slate-500" />
              Mostrar doctores sin citas
            </Button>
          ) : null}
        </div>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {bloque.columnas.map((columna) => (
        <ColumnaDoctor
          key={columna.profesionalId}
          columna={columna}
          filas={bloque.filas}
          citas={bloque.citas}
          color={colorDeServicio(columna.servicioNombre)}
          soloLectura={soloLectura}
          onLibre={onLibre}
          onOcupada={onOcupada}
        />
      ))}
    </div>
  )
}

/** La agenda de un doctor en una jornada: sus pacientes, en orden de hora. */
const ColumnaDoctor = memo(function ColumnaDoctor({
  columna,
  filas,
  citas,
  color,
  soloLectura,
  onLibre,
  onOcupada,
}: {
  columna: ColumnaHorario
  filas: FilaHorario[]
  /** Citas de la jornada, indexadas por `${profesionalId}|${hora}`. */
  citas: Record<string, CitaEnHorario[]>
  /** Color del servicio, para el distintivo de la tarjeta. */
  color: string
  soloLectura: boolean
  onLibre: (profesionalId: string, profesionalNombre: string, hora: string) => void
  onOcupada: (cita: CitaEnHorario) => void
}) {
  const [verLibres, setVerLibres] = useState(false)

  /**
   * Los pacientes del doctor y sus huecos, en el orden del dia.
   *
   * Se recorren las FILAS y no las citas porque las filas ya vienen ordenadas
   * por hora desde el servidor; ordenar aqui por el texto "HH:MM" volveria a
   * plantear el mismo problema que alli y por nada.
   */
  const { agenda, libres } = useMemo(() => {
    const agenda: CitaEnHorario[] = []
    const libres: string[] = []

    for (const fila of filas) {
      const enEsaHora = citas[`${columna.profesionalId}|${fila.hora}`]
      if (enEsaHora?.length) {
        // Pueden ser dos: el hospital a veces cita a dos pacientes con el
        // mismo doctor a la misma hora. Se ven los dos; esconder uno seria
        // perder a alguien que igual se presenta.
        agenda.push(...enEsaHora)
      } else if (fila.agendable) {
        // Solo las franjas de la configuracion. Las horas que existen porque
        // otro doctor tiene cita ahi (las 7:09) no se ofrecen: agendar en
        // ellas lo rechaza el servidor.
        libres.push(fila.hora)
      }
    }

    return { agenda, libres }
  }, [filas, citas, columna.profesionalId])

  return (
    <Card padded={false} className="flex flex-col overflow-hidden rounded-[1.375rem]">
      {/*
        El distintivo del servicio es el disco del doctor, y nada mas.

        Antes habia ademas una linea de color de punta a punta arriba de la
        tarjeta: con doce tarjetas en pantalla, esas doce lineas saturadas eran
        lo primero que se veia, por encima de los nombres y de las horas. El
        color del servicio es una ayuda para agrupar, no un titular.
      */}
      <div className="flex items-start gap-3 px-4 pb-3.5 pt-4">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${color}`}>
          <User size={21} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          {/* El nombre del doctor es el titulo de la tarjeta: sube de tamaño y
              aprieta el espaciado, como cualquier titulo de la casa. */}
          <p className="truncate text-[15px] font-semibold leading-tight tracking-[-0.018em] text-brand-950">
            {columna.profesionalNombre}
          </p>
          <p className="mt-0.5 truncate text-xs font-medium leading-tight text-slate-500">
            {columna.servicioNombre}
          </p>
          {columna.moduloNombre ? (
            <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] font-medium leading-tight text-slate-400">
              <MapPin size={12} weight="fill" className="shrink-0" />
              {columna.moduloNombre}
            </p>
          ) : null}
        </div>
        <Badge tone={columna.citas > 0 ? 'acento' : 'slate'} className="shrink-0">
          {columna.citas} {columna.citas === 1 ? 'cita' : 'citas'}
        </Badge>
      </div>

      <div className="flex-1 border-t border-slate-100 px-2.5 py-2.5">
        {agenda.length === 0 ? (
          <p className="px-1 py-5 text-center text-xs font-medium leading-5 text-slate-400">
            Sin pacientes agendados en esta jornada.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {agenda.map((cita) => (
              <li key={cita.id}>
                <button
                  type="button"
                  onClick={() => onOcupada(cita)}
                  className={`group flex w-full items-center gap-2.5 overflow-hidden rounded-xl border py-2 pl-0 pr-2.5 text-left transition-colors duration-[var(--suave)] ease-[var(--curva)] active:scale-[.99] active:transition-transform active:duration-[var(--toque)] ${
                    estilosEstado[cita.estado].fila
                  }`}
                  title={`${cita.nombrePaciente} · ${estilosEstado[cita.estado].etiqueta}`}
                >
                  {/* La franja nace en el borde de la fila, sin margen: es el
                      canto de la pieza, no un adorno puesto encima. */}
                  <span
                    className={`h-10 w-[3px] shrink-0 rounded-r-full ${estilosEstado[cita.estado].barra}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold leading-none tabular-nums tracking-[-0.01em] text-brand-950">
                        {cita.hora}
                      </span>
                      <Badge tone={estilosEstado[cita.estado].tono}>
                        {estilosEstado[cita.estado].etiqueta}
                      </Badge>
                    </span>
                    <span className="mt-1.5 flex items-center gap-1.5 text-xs font-medium leading-tight text-slate-500">
                      <User size={12} weight="fill" className="shrink-0 text-slate-300" />
                      <span className="truncate">{cita.nombrePaciente}</span>
                    </span>
                  </span>
                  {/*
                    La flecha aparece entera al pasar por encima. Presente
                    siempre y en gris palido era ruido repetido treinta veces
                    en la columna; al encenderse solo bajo el cursor, dice
                    "esta fila se abre" justo cuando hace falta saberlo.
                  */}
                  <CaretRight
                    size={14}
                    weight="bold"
                    className="shrink-0 text-slate-300 opacity-60 transition-opacity duration-[var(--suave)] group-hover:opacity-100"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Las horas libres, al pie y plegadas.

        Van aqui y no mezcladas entre los pacientes porque son dos lecturas
        distintas: los pacientes del dia se miran a cada rato, y agendar a mano
        es lo que se hace de vez en cuando, cuando llega alguien sin cita. Con
        los huecos intercalados, una agenda de treinta pacientes se leia como
        sesenta filas y habia que ir saltandose la mitad.
      */}
      {soloLectura || libres.length === 0 ? null : (
        <div className="border-t border-slate-100 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setVerLibres((antes) => !antes)}
            aria-expanded={verLibres}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-xs font-semibold text-slate-500 transition hover:text-brand-700"
          >
            <span className="flex items-center gap-1.5">
              <Plus size={13} weight="bold" />
              {libres.length} {libres.length === 1 ? 'hora libre' : 'horas libres'}
            </span>
            <CaretDown
              size={13}
              weight="bold"
              className={`transition-transform ${verLibres ? 'rotate-180' : ''}`}
            />
          </button>

          {verLibres ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {libres.map((hora) => (
                <button
                  key={hora}
                  type="button"
                  onClick={() => onLibre(columna.profesionalId, columna.profesionalNombre, hora)}
                  className="rounded-lg border border-dashed border-slate-300 px-2 py-1 text-xs font-semibold tabular-nums text-slate-500 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 active:scale-95"
                  title={`Agendar a las ${hora} con ${columna.profesionalNombre}`}
                >
                  {hora}
                </button>
              ))}
            </div>
          ) : null}
        </div>
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
    <Card padded={false} className="rounded-[1.375rem]">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
            <Warning size={20} weight="fill" />
          </span>
          <div className="min-w-0">
            <CardTitle>Citas sin doctor en la agenda ({citas.length})</CardTitle>
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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs font-semibold text-slate-500">
      <span className="flex items-center gap-2">
        <span className="h-3 w-3 rounded border border-dashed border-slate-300" />
        Hora libre para agendar
      </span>
      {/* La misma franja de color que lleva cada cita en su tarjeta, para que
          la leyenda se lea contra lo que hay en pantalla y no contra otra cosa. */}
      {(['PROGRAMADA', 'PRESENTADO', 'ATENDIDA'] as const).map((estado) => (
        <span key={estado} className="flex items-center gap-2">
          <span className={`h-3 w-1.5 rounded-sm ${estilosEstado[estado].barra}`} />
          {estilosEstado[estado].etiqueta}
        </span>
      ))}
    </div>
  )
}

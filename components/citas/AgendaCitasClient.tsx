'use client'

/**
 * Horario de citas del dia.
 *
 * La comparten dos pantallas, con el mismo comportamiento: `/admin/citas`
 * (administrador) y `/operador/agenda` (operador). Por eso vive aqui y no
 * dentro de la carpeta de un rol.
 *
 * POR QUE UNA PARRILLA Y NO UNA LISTA. En el hospital unos doctores atienden
 * en la mañana y otros en la tarde, y cada consulta ocupa un rato fijo. Con esa
 * forma, la pregunta que se hace el que agenda no es "que citas hay" sino "que
 * le queda libre a este doctor": una parrilla de doctor x hora la responde de
 * un vistazo y, sobre todo, hace imposible el error caro, que es citar dos
 * pacientes con el mismo doctor a la misma hora. El cupo se ve ocupado.
 *
 * La parrilla la arma el SERVIDOR (`horarioDelDia`), porque las franjas
 * dependen de la configuracion del hospital y de la jornada de cada doctor.
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
} from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'
import EmptyState from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Loader'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Seleccion } from '@/components/admin/Campos'
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

  /** Servicios presentes hoy, para el selector. */
  const servicios = useMemo(() => {
    const nombres = horario?.bloques.flatMap((b) => b.columnas.map((c) => c.servicioNombre)) ?? []
    return [...new Set(nombres)].sort((a, b) => a.localeCompare(b, 'es'))
  }, [horario])

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
        if (servicioFiltro && columna.servicioNombre !== servicioFiltro) return false
        if (!texto) return true
        // Se busca tambien por consultorio: el operador muchas veces sabe
        // "es el de odontologia" antes que el apellido del doctor.
        return `${columna.profesionalNombre} ${columna.moduloNombre ?? ''}`.toLowerCase().includes(texto)
      }),
    }))
  }, [horario, busquedaDiferida, servicioFiltro])

  const doctoresTotales = useMemo(
    () => new Set(horario?.bloques.flatMap((b) => b.columnas.map((c) => c.profesionalId)) ?? []).size,
    [horario],
  )
  const doctoresVisibles = useMemo(
    () => new Set(bloquesVisibles.flatMap((b) => b.columnas.map((c) => c.profesionalId))).size,
    [bloquesVisibles],
  )

  const resumen = useMemo(() => {
    if (!horario) return { agendadas: 0, cupos: 0 }
    return horario.bloques.reduce(
      (total, bloque) => ({
        agendadas: total.agendadas + Object.keys(bloque.citas).length,
        cupos: total.cupos + bloque.columnas.reduce((suma, c) => suma + c.cupos, 0),
      }),
      { agendadas: 0, cupos: 0 },
    )
  }, [horario])

  const abrirNueva = useCallback((profesionalId: string, profesionalNombre: string, hora: string) => {
    setCelda({ profesionalId, profesionalNombre, hora })
    setDocumento('')
    setNombre('')
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
      for (const hora of bloque.horas) {
        const ocupante = bloque.citas[`${destinoProfesional}|${hora}`]
        if (!ocupante || ocupante.id === aReprogramar?.id) libres.push(hora)
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
          </div>

          {horario ? (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="font-bold text-slate-600">
                <strong className="text-lg font-black text-brand-900">{resumen.agendadas}</strong> de{' '}
                {resumen.cupos} cupos ocupados
              </span>
              <span className="text-slate-400">·</span>
              <span className="font-semibold text-slate-500">
                Consultas de {horario.duracionCitaMinutos} minutos
              </span>
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
            <strong className="font-black">Registro de llegada</strong>.
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
                <dd className="tabular-nums font-black text-brand-950">{detalle.documentoPaciente}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm font-bold text-slate-500">Hora</dt>
                <dd className="tabular-nums font-black text-brand-950">{detalle.hora}</dd>
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
                    <span className="font-black text-amber-700">
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
            <strong className="font-black">reprogramarla</strong>: asi se conserva su historial en vez de
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
  soloLectura,
  onLibre,
  onOcupada,
}: {
  bloque: BloqueHorario
  filtrando: boolean
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

  // Las citas se cuentan SOLO de las columnas visibles, igual que los cupos.
  // Antes `agendadas` salia de todas las citas del bloque y `cupos` solo de las
  // columnas filtradas, asi que al filtrar por servicio el encabezado mostraba
  // cosas como "30/12".
  const visibles = new Set(bloque.columnas.map((c) => c.profesionalId))
  const agendadas = Object.values(bloque.citas).filter((c) => visibles.has(c.profesionalId)).length
  const cupos = bloque.columnas.reduce((suma, c) => suma + c.cupos, 0)

  return (
    <Card padded={false}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
              bloque.jornada === 'MANANA' ? 'bg-amber-100 text-amber-700' : 'bg-brand-50 text-brand-700'
            }`}
          >
            <Icono size={20} weight="fill" />
          </span>
          <div className="min-w-0">
            <CardTitle>{bloque.etiqueta}</CardTitle>
            <p className="text-xs font-bold text-slate-500">
              {bloque.desde} a {bloque.hasta} · {bloque.columnas.length} doctor(es)
              {filtrando ? ' que coinciden con el filtro' : ''}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-sm font-black text-slate-500">
          {agendadas}/{cupos}
        </span>
      </CardHeader>

      <CardContent padded={false}>
        {bloque.columnas.length === 0 || bloque.horas.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={CalendarPlus}
              title={
                bloque.horas.length === 0
                  ? 'Jornada sin franjas'
                  : filtrando
                    ? 'Ningun doctor coincide'
                    : 'Sin doctores en esta jornada'
              }
              description={
                bloque.horas.length === 0
                  ? 'Las horas configuradas para esta jornada no dejan espacio para ninguna consulta. Revisalas en Pantalla y audio.'
                  : filtrando
                    ? 'En esta jornada no hay doctores que coincidan con lo que buscas. Prueba con otro nombre o quita el filtro.'
                    : 'Ningun doctor activo atiende en esta jornada. Asignale la jornada a un doctor en Profesionales.'
              }
            />
          </div>
        ) : (
          // Ventana propia con desplazamiento en los dos ejes: la fila de
          // doctores queda congelada arriba y la columna de horas a la
          // izquierda, como en una hoja de calculo. El alto se limita para que
          // los encabezados tengan contra que quedarse fijos.
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {/* La esquina se cruza con las dos barras congeladas, asi
                      que va por encima de ambas. */}
                  <th className="sticky left-0 top-0 z-30 w-20 border-b border-slate-200 bg-slate-100 px-3 py-2.5 text-left text-xs font-black uppercase tracking-wide text-slate-600">
                    Hora
                  </th>
                  {bloque.columnas.map((columna) => (
                    <th
                      key={columna.profesionalId}
                      className={`sticky top-0 z-20 min-w-[210px] border-b border-l border-white/20 px-3.5 py-2.5 text-left text-white ${colorDeServicio(
                        columna.servicioNombre,
                      )}`}
                    >
                      <span className="block truncate text-lg font-black leading-tight">
                        {columna.profesionalNombre}
                      </span>
                      {columna.moduloNombre ? (
                        <span className="mt-0.5 block truncate text-base font-bold leading-tight text-white">
                          {columna.moduloNombre}
                        </span>
                      ) : null}
                      <span className="mt-1 block truncate text-xs font-semibold text-white/75">
                        {columna.servicioNombre} · {columna.ocupados}/{columna.cupos} cupos
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bloque.horas.map((hora) => (
                  <tr key={hora}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-left text-sm font-black tabular-nums text-slate-600"
                    >
                      {hora}
                    </th>
                    {bloque.columnas.map((columna) => {
                      const cita = bloque.citas[`${columna.profesionalId}|${hora}`]

                      return (
                        <td
                          key={columna.profesionalId}
                          className="border-b border-l border-slate-100 p-1 align-top"
                        >
                          {cita ? (
                            <button
                              type="button"
                              onClick={() => onOcupada(cita)}
                              className={`w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${
                                estilosEstado[cita.estado].celda
                              }`}
                              title={`${cita.nombrePaciente} · ${estilosEstado[cita.estado].etiqueta}`}
                            >
                              <span className="line-clamp-2 block whitespace-normal text-sm font-black leading-snug">
                                {cita.nombrePaciente}
                              </span>
                              <span className="mt-0.5 block truncate text-xs font-semibold opacity-70">
                                {estilosEstado[cita.estado].etiqueta}
                              </span>
                            </button>
                          ) : soloLectura ? (
                            // Dia pasado: la franja se ve, pero no se agenda.
                            <div
                              className="flex w-full items-center justify-center rounded-lg border border-dashed border-slate-100 px-2 py-2.5 text-slate-200"
                              aria-hidden="true"
                            >
                              <Minus size={14} weight="bold" />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onLibre(columna.profesionalId, columna.profesionalNombre, hora)}
                              className="flex w-full items-center justify-center rounded-lg border border-dashed border-slate-200 px-2 py-2.5 text-slate-300 transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600"
                              title={`Agendar a las ${hora} con ${columna.profesionalNombre}`}
                              aria-label={`Agendar a las ${hora} con ${columna.profesionalNombre}`}
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
    </Card>
  )
})

/**
 * Citas del dia que no caen en ninguna franja de la parrilla.
 *
 * No se esconden: un paciente que desaparece de la agenda igual se presenta en
 * el hospital. Pasa al cambiar la duracion de la consulta, el horario de una
 * jornada o la jornada de un doctor que ya tenia pacientes citados.
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
            <CardTitle>Citas fuera del horario ({citas.length})</CardTitle>
            <p className="text-xs font-bold text-slate-500">
              Quedaron en horas que ya no existen en la parrilla. Cancelalas y vuelve a agendarlas.
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
            <span className="block text-xs font-black text-amber-900">
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
        Cupo libre
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

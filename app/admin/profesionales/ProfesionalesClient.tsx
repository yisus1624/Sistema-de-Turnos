'use client'

/**
 * Catalogo de profesionales (doctores).
 *
 * Mientras la API del hospital no exista, los doctores se dan de alta a mano
 * aqui. Dos reglas del dominio que esta pantalla hace cumplir:
 *
 * 1. Un doctor no se borra, se DESACTIVA: su nombre quedo escrito en los
 *    turnos que ya llamo y borrarlo dejaria ese rastro huerfano.
 * 2. Solo existe en servicios que atienden POR CITA. En los de ventanilla la
 *    fila es compartida y la toma quien este libre, asi que un doctor asignado
 *    ahi no tendria pacientes propios a quien llamar.
 *
 * El enlace con el que cada doctor entra a su consultorio NO se maneja aqui,
 * sino en "Enlaces de consultorio". Van separados a proposito: repartir
 * enlaces es trabajo del dia a dia y se le puede encargar al operador del
 * mostrador, mientras que tocar el catalogo (la jornada, sobre todo) le mueve
 * la agenda a todo el hospital.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowsClockwise, IdentificationCard, Plus } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Interruptor, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import type {
  Jornada,
  JornadaDelDia,
  Modulo,
  Profesional,
  ResumenRecalculo,
  Servicio,
} from '@/lib/turnos/types'

const COLUMNAS = ['Profesional', 'Servicio', 'Ese dia', 'Jornada habitual', 'Consultorio', 'Estado']

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
 * La de cada dia sale de las citas de ese dia y se ve en la columna "Ese dia".
 * Esta solo decide a que horas se le puede agendar el PRIMER paciente de un
 * dia que todavia esta vacio; en cuanto tiene una cita, mandan sus citas.
 */
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

/**
 * Lo que un doctor trabajo el dia que se esta mirando.
 *
 * "NO TRABAJA" ES UNA RESPUESTA, NO UN HUECO. El doctor sin ni una cita ese
 * dia no vino, y decirlo asi es la mitad de lo que se vino a preguntar aqui.
 * El rango de horas debajo esta para poder mirar el veredicto y creerlo sin
 * abrir la parrilla.
 */
function EseDia({ jornada, cargando }: { jornada?: JornadaDelDia; cargando: boolean }) {
  if (cargando) return <span className="text-sm font-semibold text-slate-300">…</span>

  if (!jornada?.jornada) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge tone="slate">No trabaja</Badge>
        <span className="text-xs font-semibold text-slate-400">sin citas ese dia</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Badge tone={tonoJornada[jornada.jornada]}>{etiquetaJornada[jornada.jornada]}</Badge>
      <span className="text-xs font-semibold text-slate-400">
        {jornada.citas} cita(s) · {jornada.desde}–{jornada.hasta}
      </span>
    </div>
  )
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
  const [jornadasDelDia, setJornadasDelDia] = useState<Map<string, JornadaDelDia>>(new Map())
  const [cargandoJornadas, setCargandoJornadas] = useState(true)

  // Recalculo de la jornada habitual, sobre el periodo que elija quien lo pide.
  const [recalculoAbierto, setRecalculoAbierto] = useState(false)
  const [recalculando, setRecalculando] = useState(false)
  const [periodo, setPeriodo] = useState({ desde: '', hasta: '' })

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

  /** Lo que cada doctor trabajo el dia que se esta mirando. */
  const cargarJornadasDelDia = useCallback(async (dia: string) => {
    setCargandoJornadas(true)
    try {
      const { jornadas } = await pedir<{ jornadas: JornadaDelDia[] }>(
        `/api/turnos/profesionales/jornadas?fecha=${dia}`,
      )
      setJornadasDelDia(new Map(jornadas.map((j) => [j.profesionalId, j])))
    } catch (error) {
      toast.error('No se pudo cargar lo que trabajaron ese dia', mensajeDeError(error))
      setJornadasDelDia(new Map())
    } finally {
      setCargandoJornadas(false)
    }
  }, [])

  /**
   * Vuelve a deducir la jornada HABITUAL de cada doctor de sus citas del
   * periodo.
   *
   * Se deduce dia por dia y gana la que mas se repite. Juntando las horas de
   * todo el periodo en un monton, bastaba una tarde suelta al mes para que un
   * medico de mañanas saliera de "dia completo", y sobre treinta dias eso
   * acababa poniendo a todo el mundo en dia completo.
   */
  const recalcularJornadas = useCallback(async () => {
    setRecalculando(true)
    try {
      const resumen = await pedir<ResumenRecalculo>('/api/turnos/profesionales/jornadas', {
        method: 'POST',
        body: JSON.stringify(periodo),
      })

      const periodoLegible = `${resumen.desde} a ${resumen.hasta} · ${resumen.diasMirados} dia(s)`
      if (resumen.ajustes.length === 0) {
        toast.info(
          'No hubo nada que cambiar',
          `${periodoLegible}. La jornada habitual de cada doctor ya coincide con sus citas.`,
        )
      } else {
        toast.success(
          `${resumen.ajustes.length} doctor(es) cambiaron de jornada habitual`,
          resumen.ajustes
            .map(
              (a) =>
                `${a.nombre}: ${etiquetaJornada[a.anterior]} → ${etiquetaJornada[a.jornada]} (${a.diasTrabajados} dia(s) trabajados)`,
            )
            .join(' · '),
        )
      }

      setRecalculoAbierto(false)
      await cargar()
    } catch (error) {
      toast.error('No se pudieron recalcular las jornadas', mensajeDeError(error))
    } finally {
      setRecalculando(false)
    }
  }, [cargar, periodo])

  function abrirRecalculo() {
    // Por defecto, el ultimo mes hasta el dia que se esta mirando: es el
    // periodo que hace falta para responder "que suele hacer este doctor", y
    // se deja cambiar porque un mes no es lo mismo en enero que en diciembre.
    const hasta = fecha
    const desde = new Date(Date.parse(`${fecha}T12:00:00Z`) - 29 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    setPeriodo({ desde, hasta })
    setRecalculoAbierto(true)
  }

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
    return (id?: string | null) => (id ? (mapa.get(id) ?? '—') : '—')
  }, [modulos])

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

  function abrirNuevo() {
    setEditando(null)
    setFormulario({ ...DOCTOR_VACIO, servicioId: serviciosConCita[0]?.id ?? '' })
    setAbierto(true)
  }

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

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    setGuardando(true)

    const cuerpo = {
      nombre: formulario.nombre,
      servicioId: formulario.servicioId,
      jornada: formulario.jornada,
      moduloId: formulario.moduloId || null,
    }

    try {
      if (editando) {
        await pedir(`/api/turnos/profesionales/${editando.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...cuerpo, activo: formulario.activo }),
        })
        toast.success('Profesional actualizado', formulario.nombre)
      } else {
        await pedir('/api/turnos/profesionales', { method: 'POST', body: JSON.stringify(cuerpo) })
        toast.success('Profesional creado', `Ya se le pueden agendar citas a ${formulario.nombre}.`)
      }
      setAbierto(false)
      await cargar()
    } catch (error) {
      toast.error('No se pudo guardar', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <Card padded={false}>
        <CardHeader>
          <CardTitle>Profesionales ({profesionales.length})</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {/*
              La jornada sale de las citas y no de lo que alguien recuerde. El
              boton esta aqui y no escondido en un menu porque hoy el catalogo
              entero dice "dia completo": es lo primero que hay que corregir.
            */}
            <Button
              size="sm"
              variant="secondary"
              onClick={abrirRecalculo}
              title="Deduce la jornada habitual de cada doctor de las horas a las que tuvo citas en el periodo que elijas"
            >
              <ArrowsClockwise size={16} weight="bold" />
              Recalcular jornadas
            </Button>
            <Button size="sm" onClick={abrirNuevo} disabled={serviciosConCita.length === 0}>
              <Plus size={17} weight="bold" />
              Nuevo doctor
            </Button>
          </div>
        </CardHeader>
        {/*
          EL DIA QUE SE ESTA MIRANDO. La columna "Ese dia" sale de las citas de
          esta fecha, asi que sin poder moverla la tabla solo sabria contestar
          por hoy, y la pregunta del hospital es "¿que trabajo este doctor el
          lunes?". No hay tope hacia atras: las citas de todos los dias
          cargados siguen ahi.
        */}
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-4">
          <Campo etiqueta="Dia" className="w-full max-w-[190px]">
            <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          {fecha !== hoyEnColombia() ? (
            <Button size="sm" variant="secondary" className="mb-0.5" onClick={() => setFecha(hoyEnColombia())}>
              Hoy
            </Button>
          ) : null}
          <p className="mb-1.5 max-w-md text-sm leading-6 text-slate-500">
            <strong className="font-black text-slate-600">Ese dia</strong> es lo que dicen sus citas
            de esa fecha; <strong className="font-black text-slate-600">jornada habitual</strong> es
            la de su ficha, y solo decide a que horas se le agenda el primer paciente de un dia
            vacio.
          </p>
        </div>

        <CardContent padded={false}>
          {cargando ? (
            <TablaSkeleton columnas={COLUMNAS} />
          ) : profesionales.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={IdentificationCard}
                title="Sin profesionales"
                description="Crea el primer doctor para poder agendarle citas."
              />
            </div>
          ) : (
            <Tabla columnas={COLUMNAS}>
              {profesionales.map((profesional) => (
                <tr
                  key={profesional.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => abrirEdicion(profesional)}
                >
                  <td className="px-4 py-3 font-black text-brand-950">{profesional.nombre}</td>
                  <td className="px-4 py-3 text-slate-600">{nombreServicio(profesional.servicioId)}</td>
                  <td className="px-4 py-3">
                    <EseDia jornada={jornadasDelDia.get(profesional.id)} cargando={cargandoJornadas} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tonoJornada[profesional.jornada]}>
                      {etiquetaJornada[profesional.jornada]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{nombreModulo(profesional.moduloId)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={profesional.activo ? 'green' : 'slate'}>
                      {profesional.activo ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-sm leading-6 text-slate-500">
        El enlace con el que cada doctor entra a su consultorio se genera en{' '}
        <strong className="font-black text-slate-600">Enlaces de consultorio</strong>.
      </p>

      <Modal
        open={recalculoAbierto}
        onClose={() => setRecalculoAbierto(false)}
        title="Recalcular jornadas habituales"
        description="Mira las citas que los doctores tuvieron de verdad en el periodo y le pone a cada uno la jornada que mas dias repitio."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Desde">
              <Entrada
                type="date"
                value={periodo.desde}
                onChange={(e) => setPeriodo((p) => ({ ...p, desde: e.target.value }))}
              />
            </Campo>
            <Campo etiqueta="Hasta">
              <Entrada
                type="date"
                value={periodo.hasta}
                onChange={(e) => setPeriodo((p) => ({ ...p, hasta: e.target.value }))}
              />
            </Campo>
          </div>

          <p className="text-sm leading-6 text-slate-500">
            Al doctor que no tenga ni una cita en el periodo no se le toca: sin citas no hay nada
            que deducir, y cambiarsela seria pisar la que se puso a mano. Esto no cambia ninguna
            cita ya agendada.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRecalculoAbierto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={recalcularJornadas}
              loading={recalculando}
              disabled={!periodo.desde || !periodo.hasta || periodo.hasta < periodo.desde}
            >
              Recalcular
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={editando ? 'Editar profesional' : 'Nuevo doctor'}
        description="Los doctores atienden por cita: el servicio decide en que fila entran sus pacientes."
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

            <Campo etiqueta="Jornada" ayuda="En que parte del dia atiende. Decide a que horas se le puede agendar.">
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
                <p className="text-sm font-black text-slate-800">Activo</p>
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
              {editando ? 'Guardar cambios' : 'Crear doctor'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

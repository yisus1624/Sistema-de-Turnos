'use client'

/**
 * Pantalla del doctor (acceso por enlace temporal, sin usuario ni contrasena).
 *
 * Pensada para usarse rapido entre paciente y paciente: el boton principal es
 * grande porque el doctor la usa de pie o entre dos consultas, no sentado
 * revisando un formulario. El nombre completo del paciente SI se muestra
 * aqui (es el medico tratante, no la pantalla publica).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowClockwise,
  CheckCircle,
  Info,
  MapPin,
  Megaphone,
  Stethoscope,
  UserMinus,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Seleccion } from '@/components/admin/Campos'
import { esRechazoDeAcceso, hoyEnColombia, horaCorta, mensajeDeError, pedir } from '@/lib/api/cliente'
import { useRecargaEnVivo } from '@/lib/hooks'
import { afectaALaFila } from '@/lib/realtime/canal'
import { IndicadorConexion } from '@/components/ui/IndicadorConexion'
import { Isotipo, NOMBRE_INSTITUCION } from '@/components/brand/Marca'
import { cn } from '@/lib/ui'
import type { EstadoAgendaItem, ItemAgendaProfesional, Modulo, Profesional, Turno } from '@/lib/turnos/types'

type Accion = 'llamar' | 'repetir' | 'atendido' | 'ausente' | null

/**
 * Esta pantalla no entra con sesion sino con un enlace temporal, asi que un 401
 * significa "el enlace vencio", no "vuelve a entrar". Mandar al doctor a un
 * login donde no tiene cuenta lo dejaria atascado; el aviso de enlace no valido
 * que ya muestra abajo es lo correcto.
 */
const SIN_LOGIN = { sinRedirigirAlLogin: true } as const

/**
 * Cuanto puede durar como maximo una accion antes de darla por perdida.
 *
 * El refresco automatico se salta mientras el doctor esta ejecutando una
 * accion, para no pisarle la pantalla a media operacion. Si una peticion se
 * queda colgada (la red se fue justo ahi) y nadie suelta esa marca, la pantalla
 * deja de actualizarse para el resto de la jornada. Pasado este tiempo se
 * libera y el refresco continua.
 */
const MS_MAXIMO_POR_ACCION = 20000

/** Como se ve cada estado de la agenda para el doctor: color y texto humano. */
const ETIQUETA_AGENDA: Record<EstadoAgendaItem, { texto: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'slate' }> = {
  PROGRAMADA: { texto: 'Aun no ha llegado', tone: 'slate' },
  EN_ESPERA: { texto: 'En espera', tone: 'blue' },
  LLAMADO: { texto: 'En atencion', tone: 'amber' },
  EN_ATENCION: { texto: 'En atencion', tone: 'amber' },
  ATENDIDA: { texto: 'Atendido', tone: 'green' },
  AUSENTE: { texto: 'No se presento', tone: 'red' },
}

type TonoAviso = 'rojo' | 'ambar'

const COLOR_AVISO: Record<TonoAviso, string> = {
  rojo: 'bg-red-50 text-red-600',
  ambar: 'bg-amber-50 text-amber-600',
}

function AvisoAPantallaCompleta({
  tono,
  titulo,
  descripcion,
}: {
  tono: TonoAviso
  titulo: string
  descripcion: string
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-6 text-center">
      <div className="max-w-md space-y-4">
        <div className={cn('mx-auto grid h-16 w-16 place-items-center rounded-2xl', COLOR_AVISO[tono])}>
          <WarningCircle size={32} weight="fill" />
        </div>
        <h1 className="text-xl font-black tracking-[-0.02em] text-brand-950">{titulo}</h1>
        <p className="text-sm leading-6 text-slate-600">{descripcion}</p>
      </div>
    </main>
  )
}

export default function ConsultorioClient({ token }: { token: string }) {
  const [cargando, setCargando] = useState(true)
  const [tokenInvalido, setTokenInvalido] = useState(false)
  const [sinConexion, setSinConexion] = useState(false)

  const [profesional, setProfesional] = useState<Profesional | null>(null)
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [moduloId, setModuloId] = useState('')
  const [pendientes, setPendientes] = useState<Turno[]>([])
  const [turnoActual, setTurnoActual] = useState<Turno | null>(null)
  const [agenda, setAgenda] = useState<ItemAgendaProfesional[]>([])
  // Que dia de la agenda se esta viendo. Por defecto hoy; el doctor puede
  // revisar otro dia sin que eso afecte a quien puede llamar (eso siempre
  // sale de los turnos EN_ESPERA de HOY, via `pendientes`).
  const [fecha, setFecha] = useState(hoyEnColombia())
  const [accion, setAccion] = useState<Accion>(null)
  // El refresco automatico lee la accion en curso desde una ref: si dependiera
  // del estado, el intervalo se recrearia en cada clic.
  const accionRef = useRef<Accion>(null)

  useEffect(() => {
    accionRef.current = accion
  }, [accion])

  const cargarEstado = useCallback(async () => {
    try {
      const data = await pedir<{
        profesional: Profesional
        modulos: Modulo[]
        pendientes: Turno[]
        turnoActual: Turno | null
        agenda: ItemAgendaProfesional[]
      }>(`/api/consultorio/${token}?fecha=${fecha}`, SIN_LOGIN)

      setProfesional(data.profesional)
      setModulos(data.modulos)
      setPendientes(data.pendientes)
      setTurnoActual(data.turnoActual)
      setAgenda(data.agenda)
      // El consultorio habitual del doctor queda preseleccionado.
      //
      // Y SOLO ESE. Antes, si el doctor no tenia consultorio asignado, se caia
      // al primero de la lista de su servicio, que es el de OTRO doctor: sin
      // decir nada, llamaba a sus pacientes a la puerta equivocada y le cerraba
      // como atendido al paciente que ese colega tuviera adentro. Sin
      // consultorio asignado no se elige ninguno: el doctor lo escoge a mano y
      // el servidor comprueba que pueda usarlo.
      setModuloId((actual) => actual || data.profesional.moduloId || '')
      setTokenInvalido(false)
      setSinConexion(false)
    } catch (error) {
      // SOLO un rechazo real de acceso vence el enlace. Antes cualquier fallo
      // lo daba por vencido: un microcorte de wifi le mostraba al doctor "este
      // enlace ya no es valido" y ademas apagaba el refresco para siempre, con
      // el enlace bueno en la mano y pacientes esperando.
      if (esRechazoDeAcceso(error)) setTokenInvalido(true)
      else setSinConexion(true)
    } finally {
      setCargando(false)
    }
  }, [token, fecha])

  useEffect(() => {
    cargarEstado()
  }, [cargarEstado])

  const refrescarSiNoHayAccion = useCallback(() => {
    // No mientras el doctor esta ejecutando una accion: pisarle el estado a
    // media operacion lo unico que hace es parpadear la pantalla.
    if (accionRef.current !== null) return
    void cargarEstado()
  }, [cargarEstado])

  /**
   * Refresco automatico, en vivo.
   *
   * Al doctor le interesa un solo evento, el de SU fila: el paciente que acaba
   * de registrar su llegada en admisiones tiene que aparecerle al instante. No
   * hay refresco por reloj a proposito (ver `useRecargaEnVivo`): la pantalla se
   * pone al dia sola al reconectar, al volver al frente y al volver la red, y
   * mientras tanto el indicador dice si lo que se ve sigue siendo cierto.
   */
  const conexion = useRecargaEnVivo(refrescarSiNoHayAccion, {
    activo: !tokenInvalido,
    interesa: (evento) => afectaALaFila(evento, { profesionalId: profesional?.id }),
  })

  async function ejecutar(nombre: Accion, tarea: () => Promise<void>) {
    setAccion(nombre)
    // Una accion colgada no puede congelar el refresco: se suelta sola.
    const soltar = setTimeout(() => setAccion(null), MS_MAXIMO_POR_ACCION)
    try {
      await tarea()
    } catch (error) {
      toast.error('No se pudo completar la accion', mensajeDeError(error))
    } finally {
      clearTimeout(soltar)
      setAccion(null)
    }
  }

  const llamarSiguiente = () =>
    ejecutar('llamar', async () => {
      const { turno } = await pedir<{ turno: Turno }>(`/api/consultorio/${token}/llamar-siguiente`, {
        method: 'POST', ...SIN_LOGIN,
        body: JSON.stringify({ moduloId }),
      })
      setTurnoActual(turno)
      toast.success('Paciente llamado', turno.nombrePaciente ?? turno.codigo)
      await cargarEstado()
    })

  const repetirLlamado = () =>
    ejecutar('repetir', async () => {
      if (!turnoActual) return
      const { turno } = await pedir<{ turno: Turno }>(`/api/consultorio/${token}/${turnoActual.id}/repetir`, {
        method: 'POST', ...SIN_LOGIN,
      })
      setTurnoActual(turno)
      toast.info('Llamado repetido', turno.nombrePaciente ?? turno.codigo)
    })

  const cerrarTurno = (tipo: 'atendido' | 'ausente') =>
    ejecutar(tipo, async () => {
      if (!turnoActual) return
      await pedir(`/api/consultorio/${token}/${turnoActual.id}/${tipo}`, { method: 'POST', ...SIN_LOGIN })
      toast[tipo === 'atendido' ? 'success' : 'warning'](
        tipo === 'atendido' ? 'Atencion finalizada' : 'Paciente ausente',
        turnoActual.nombrePaciente ?? turnoActual.codigo,
      )
      setTurnoActual(null)
      await cargarEstado()
    })

  const programadosHoy = agenda.filter((item) => item.estado === 'PROGRAMADA').length
  // Al doctor solo le mostramos pacientes confirmados (ya registraron su
  // llegada en admisiones); los que aun no llegan solo generan el aviso de
  // arriba, para no llenarle la agenda de citas con las que no puede hacer nada.
  const agendaConfirmada = agenda.filter((item) => item.estado !== 'PROGRAMADA')
  const esHoy = fecha === hoyEnColombia()
  // Sin pacientes en espera no hay a quien llamar: el boton se apaga en vez de
  // dejar que el doctor lo pulse y reciba un error.
  const puedeLlamar = Boolean(moduloId) && pendientes.length > 0

  if (cargando) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 px-6">
        <p className="text-sm font-bold text-slate-500">Cargando tu consultorio...</p>
      </main>
    )
  }

  if (tokenInvalido) {
    return (
      <AvisoAPantallaCompleta
        tono="rojo"
        titulo="Este enlace ya no es valido"
        descripcion="Puede que haya vencido o que se haya generado uno nuevo. Pide un enlace nuevo a la oficina de sistemas del hospital."
      />
    )
  }

  // Sin datos y sin rechazo del servidor: el enlace sirve, lo que fallo fue la
  // conexion. Se sigue reintentando solo.
  if (!profesional) {
    return (
      <AvisoAPantallaCompleta
        tono="ambar"
        titulo="Sin conexion con el servidor"
        descripcion="No se pudieron cargar tus pacientes. Tu enlace sigue siendo valido: en cuanto vuelva la conexion se carga solo, no hace falta que recargues."
      />
    )
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Isotipo size={40} />
            <div className="leading-tight">
              <p className="text-lg font-black tracking-[-0.02em] text-brand-950">{profesional.nombre}</p>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{NOMBRE_INSTITUCION}</p>
            </div>
          </div>
          {/*
            El consultorio se puede cambiar: el doctor a veces atiende en otra
            puerta, y si no tiene uno asignado esta es la unica forma de que
            pueda trabajar. La lista solo trae los de su servicio, y el
            servidor vuelve a comprobarlo antes de llamar.
          */}
          <div className="flex items-center gap-2">
            <IndicadorConexion estado={conexion} />
            <MapPin size={18} weight="bold" className="shrink-0 text-brand-600" />
            <Seleccion
              value={moduloId}
              onChange={(e) => setModuloId(e.target.value)}
              aria-label="Consultorio desde el que llamas"
              className="max-w-[14rem]"
            >
              <option value="">Elige tu consultorio</option>
              {modulos.map((modulo) => (
                <option key={modulo.id} value={modulo.id}>
                  {modulo.nombre}
                </option>
              ))}
            </Seleccion>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Paciente en atencion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {turnoActual ? (
              <div className="rounded-2xl border-2 border-brand-100 bg-brand-50 p-6 text-center">
                <p className="text-xs font-bold uppercase tracking-wide text-brand-600">Turno en atencion</p>
                <p className="mt-1 text-5xl font-black tracking-[-0.03em] text-brand-950">
                  {turnoActual.codigo}
                </p>
                {turnoActual.nombrePaciente ? (
                  <p className="mt-2 text-2xl font-black text-slate-800">{turnoActual.nombrePaciente}</p>
                ) : null}
                <p className="mt-2 text-sm font-semibold text-brand-700">
                  Llamado {turnoActual.vecesLlamado} {turnoActual.vecesLlamado === 1 ? 'vez' : 'veces'}
                  {turnoActual.horaLlamado ? ` · ${horaCorta(turnoActual.horaLlamado)}` : ''}
                </p>
              </div>
            ) : (
              <EmptyState
                icon={Stethoscope}
                title="Sin paciente en atencion"
                description="Pulsa el boton para llamar al proximo paciente en espera."
              />
            )}

            {/*
              Sin esto, un doctor con citas programadas pero sin nadie EN_ESPERA
              ve el boton apagado y cree que el sistema esta roto. El aviso
              explica que falta el paso de admisiones (registrar la llegada).
            */}
            {sinConexion ? (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0" />
                <span>
                  Sin conexion con el servidor: lo que ves puede estar desactualizado. Se pone al
                  dia solo en cuanto vuelva la conexion.
                </span>
              </div>
            ) : null}

            {!moduloId ? (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0" />
                <span>
                  No tienes consultorio asignado. Elige arriba desde cual estas atendiendo: es el numero
                  que va a ver el paciente en la pantalla de la sala de espera.
                </span>
              </div>
            ) : null}

            {!turnoActual && pendientes.length === 0 && esHoy && programadosHoy > 0 ? (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <Info size={20} weight="fill" className="mt-0.5 shrink-0" />
                <span>
                  Tienes {programadosHoy} {programadosHoy === 1 ? 'paciente' : 'pacientes'} en agenda para
                  hoy; {programadosHoy === 1 ? 'aparecera' : 'aparecerán'} para llamar cuando{' '}
                  {programadosHoy === 1 ? 'registre' : 'registren'} su llegada en admisiones.
                </span>
              </div>
            ) : null}

            <Button
              onClick={llamarSiguiente}
              loading={accion === 'llamar'}
              disabled={!puedeLlamar}
              className="h-16 w-full text-lg"
            >
              <Megaphone size={22} weight="bold" />
              Siguiente paciente
            </Button>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={repetirLlamado}
                loading={accion === 'repetir'}
                variant="secondary"
                disabled={!turnoActual}
              >
                <ArrowClockwise size={18} weight="bold" />
                Repetir llamado
              </Button>
              <Button
                onClick={() => cerrarTurno('atendido')}
                loading={accion === 'atendido'}
                variant="dark"
                disabled={!turnoActual}
              >
                <CheckCircle size={18} weight="bold" />
                Atendido
              </Button>
              <Button
                onClick={() => cerrarTurno('ausente')}
                loading={accion === 'ausente'}
                variant="danger"
                disabled={!turnoActual}
              >
                <UserMinus size={18} weight="bold" />
                No se presento
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <CardTitle>Agenda del dia ({agendaConfirmada.length})</CardTitle>
              <Campo etiqueta="Fecha" className="max-w-[10rem]">
                <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </Campo>
            </div>
          </CardHeader>
          <CardContent>
            {/*
              Solo pacientes CONFIRMADOS (ya registraron llegada en admisiones).
              Los que aun no llegan (PROGRAMADA) no aportan nada aqui: ya se
              avisa arriba cuantos faltan por confirmar.
            */}
            {agendaConfirmada.length === 0 ? (
              <p className="text-sm text-slate-500">
                {agenda.length > 0
                  ? 'Aun no hay pacientes confirmados para este dia.'
                  : 'No tienes citas programadas para este dia.'}
              </p>
            ) : (
              <ol className="space-y-2">
                {agendaConfirmada.map((item) => {
                  // Un turno que se cerro solo (al pasar al siguiente sin
                  // cerrar al anterior) se veia igual que uno atendido de
                  // verdad. Se marca aparte para que el doctor pueda notarlo.
                  const etiqueta =
                    item.estado === 'ATENDIDA' && item.cierreAutomatico
                      ? { texto: 'Cerrado al pasar al siguiente', tone: 'slate' as const }
                      : ETIQUETA_AGENDA[item.estado]
                  return (
                    <li
                      key={item.citaId}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 text-sm shadow-sm"
                    >
                      <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">
                        {horaCorta(item.horaCita)}
                      </span>
                      {item.codigo ? (
                        <span className="shrink-0 font-black text-brand-950">{item.codigo}</span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{item.nombrePaciente}</span>
                      <Badge tone={etiqueta.tone}>{etiqueta.texto}</Badge>
                    </li>
                  )
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

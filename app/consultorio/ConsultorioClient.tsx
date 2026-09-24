'use client'

/**
 * Pantalla del doctor (acceso por enlace temporal, sin usuario ni contrasena).
 *
 * Pensada para usarse rapido entre paciente y paciente: las acciones son
 * grandes porque el doctor la usa de pie o entre dos consultas, no sentado
 * revisando un formulario. El nombre completo del paciente SI se muestra
 * aqui (es el medico tratante, no la pantalla publica).
 *
 * El doctor NO elige consultorio ni fecha: atiende en el consultorio que trae
 * asignado en la agenda del hospital, y siempre ve el dia de hoy. Si se
 * equivoca (llama al siguiente sin querer, o lo marca atendido antes de
 * tiempo), "Retroceder" lo deshace (ver `lib/turnos/reglas-retroceso.ts`).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { esRechazoDeAcceso, hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import type { ResultadoDeCarga } from '@/lib/api/reintento'
import {
  useCargaConReintento,
  useComprobacionPeriodica,
  useFechaQueSigueAHoy,
  useRecargaEnVivo,
  useUltimaPeticion,
} from '@/lib/hooks'
import { avisoDePacienteYaLlamado, llamarSiguienteDesde } from '@/lib/api/llamado-cliente'
import { afectaALaFila } from '@/lib/realtime/canal'
import { etiquetaDeRetroceso, resumenDelDia } from '@/lib/consultorio/presentacion'
import type { PlanDeRetroceso } from '@/lib/turnos/reglas-retroceso'
import type { ItemAgendaProfesional, Modulo, Profesional, Servicio, Turno } from '@/lib/turnos/types'
import { EncabezadoConsultorio } from './EncabezadoConsultorio'
import { TarjetaPaciente } from './TarjetaPaciente'
import { BotonesDeAtencion, type AccionDoctor } from './BotonesDeAtencion'
import { AgendaDeHoy } from './AgendaDeHoy'
import { ConfirmarRetroceso } from './ConfirmarRetroceso'
import { Aviso, AvisoAPantallaCompleta, ComprobarDeNuevo } from './AvisosConsultorio'

type Accion = AccionDoctor | null

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

/*
  YA NO RECIBE EL TOKEN, Y NO PUEDE RECIBIRLO.

  Lo tenia como propiedad y lo pegaba en la ruta de cada llamada, que es como
  acababa escrito en el registro de peticiones del servidor. Ahora el token
  vive en una cookie `HttpOnly` que pone `proxy.ts` al canjear el enlace: el
  navegador la manda sola en cada peticion a `/api/consultorio` y este codigo
  ni la ve ni puede verla. Si algun dia alguien quisiera volver a mandarlo por
  la URL, tendria que ir a buscarlo a otra parte, que es justo la friccion que
  se busca.
*/
export default function ConsultorioClient() {
  const [cargando, setCargando] = useState(true)
  const [tokenInvalido, setTokenInvalido] = useState(false)
  const [sinConexion, setSinConexion] = useState(false)

  const [profesional, setProfesional] = useState<Profesional | null>(null)
  // El consultorio ASIGNADO en la agenda del hospital. No se elige aqui.
  const [consultorio, setConsultorio] = useState<Modulo | null>(null)
  const [servicio, setServicio] = useState<Servicio | null>(null)
  const [pendientes, setPendientes] = useState<Turno[]>([])
  const [turnoActual, setTurnoActual] = useState<Turno | null>(null)
  const [agenda, setAgenda] = useState<ItemAgendaProfesional[]>([])
  // Lo que haria "Retroceder" ahora mismo, tal como lo calcula el servidor.
  const [retroceso, setRetroceso] = useState<PlanDeRetroceso | null>(null)
  const [confirmandoRetroceso, setConfirmandoRetroceso] = useState(false)
  // Siempre hoy: el doctor no elige dia. Pasa solo al siguiente a medianoche.
  const [fecha, setFecha] = useState(hoyEnColombia())
  useFechaQueSigueAHoy(setFecha)
  const [accion, setAccion] = useState<Accion>(null)
  // El refresco automatico lee la accion en curso desde una ref: si dependiera
  // del estado, el intervalo se recrearia en cada clic.
  const accionRef = useRef<Accion>(null)

  // SOLO el consultorio asignado. Sin el no se llama a nadie: caer en otro (el
  // primero de la lista, como se hizo alguna vez) mandaba a los pacientes a la
  // puerta de otro doctor y le cerraba al paciente que ese tuviera adentro.
  const moduloId = consultorio?.id ?? ''

  useEffect(() => {
    accionRef.current = accion
  }, [accion])

  // Solo cuenta la ultima recarga: el canal en vivo, el final de cada accion y
  // el cambio de dia recargan a la vez, y una respuesta vieja que llegara
  // tarde pintaria "sin paciente" encima del paciente real.
  const recargas = useUltimaPeticion()

  const cargarEstado = useCallback(async (): Promise<ResultadoDeCarga> => {
    const recarga = recargas.iniciar()
    try {
      const data = await pedir<{
        profesional: Profesional
        consultorio: Modulo | null
        servicio: Servicio | null
        pendientes: Turno[]
        turnoActual: Turno | null
        agenda: ItemAgendaProfesional[]
        retroceso: PlanDeRetroceso | null
      }>(`/api/consultorio?fecha=${fecha}`, { ...SIN_LOGIN, signal: recarga.signal })
      if (!recarga.esVigente()) return 'reemplazada'

      setProfesional(data.profesional)
      setConsultorio(data.consultorio)
      setServicio(data.servicio)
      setPendientes(data.pendientes)
      setTurnoActual(data.turnoActual)
      setAgenda(data.agenda)
      setRetroceso(data.retroceso ?? null)
      setTokenInvalido(false)
      setSinConexion(false)
    } catch (error) {
      if (!recarga.esVigente()) return 'reemplazada'
      // SOLO un rechazo real de acceso vence el enlace. Antes cualquier fallo
      // lo daba por vencido: un microcorte de wifi le mostraba al doctor "este
      // enlace ya no es valido" y ademas apagaba el refresco para siempre, con
      // el enlace bueno en la mano y pacientes esperando.
      if (esRechazoDeAcceso(error)) setTokenInvalido(true)
      else setSinConexion(true)
      // Se relanza para que `useCargaConReintento` decida si reintentar: un
      // fallo pasajero se reintenta solo y enseguida; un rechazo no se martilla,
      // lo vuelve a comprobar `useComprobacionPeriodica`, mas espaciado.
      throw error
    } finally {
      if (recarga.esVigente()) setCargando(false)
    }
  }, [fecha, recargas])

  // La carga se reintenta sola con espera creciente si falla (429, 500, sin
  // red), sin esperar a que llegue un evento que interese a este doctor.
  const recargar = useCargaConReintento(cargarEstado, {
    // Durante una accion del doctor no se reintenta: la accion recarga al
    // terminar, y una recarga en medio le pisaria la pantalla.
    omitirReintento: () => accionRef.current !== null,
  })

  useEffect(() => {
    void recargar()
  }, [cargarEstado, recargar])

  /*
    EL ENLACE RECHAZADO NO ES UN FINAL. Un 401 o un 403 tambien llegan por un
    freno pasajero del servidor o por un intermediario (nginx, un WAF), y antes
    la pantalla se quedaba en rojo, sin canal en vivo y sin volver a intentarlo,
    hasta que alguien pulsara F5: todos los consultorios caidos por un rato de
    rechazo. Ahora lo sigue comprobando sola; un enlace revocado de verdad sigue
    rechazado y el aviso se queda.
  */
  useComprobacionPeriodica(tokenInvalido, recargar)
  const [comprobando, setComprobando] = useState(false)
  const comprobarAhora = async () => {
    setComprobando(true)
    try {
      await recargar()
    } finally {
      setComprobando(false)
    }
  }

  const refrescarSiNoHayAccion = useCallback(() => {
    // No mientras el doctor esta ejecutando una accion: pisarle el estado a
    // media operacion lo unico que hace es parpadear la pantalla. No se pierde:
    // al terminar, `ejecutar` recarga siempre.
    if (accionRef.current !== null) return
    void recargar()
  }, [recargar])

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
    // Con el consultorio declarado, los llamados de los demas consultorios ya
    // no obligan a recargar: no mueven la fila de este doctor (ver
    // `afectaALaFila`). Sus propias acciones si recargan, por su propio camino.
    interesa: (evento) =>
      afectaALaFila(evento, {
        profesionalId: profesional?.id,
        moduloId: moduloId || null,
        moduloDelTurnoAbierto: turnoActual?.moduloId ?? null,
      }),
  })

  async function ejecutar(nombre: Accion, tarea: () => Promise<void>) {
    // Una recarga que salio ANTES de la accion trae el estado de antes: no
    // puede aterrizar despues y tapar lo que la accion acaba de cambiar.
    recargas.cancelar()
    setAccion(nombre)
    // El plan de "Retroceder" que se ve ya no vale: esta accion lo cambia. Se
    // apaga hasta que la recarga de abajo traiga el nuevo, y asi nunca se
    // ofrece deshacer algo que ya no es lo ultimo que paso.
    setRetroceso(null)
    // Una accion colgada no puede congelar el refresco: se suelta sola.
    const soltar = setTimeout(() => setAccion(null), MS_MAXIMO_POR_ACCION)
    try {
      await tarea()
    } catch (error) {
      toast.error('No se pudo completar la accion', mensajeDeError(error))
    } finally {
      clearTimeout(soltar)
      setAccion(null)
      // SIEMPRE, salga bien o mal. Con la red lenta el servidor puede haber
      // llamado al paciente y perderse solo la respuesta: si la pantalla no se
      // pone al dia, el doctor ve el error sobre el estado viejo, vuelve a
      // pulsar "Llamar siguiente", y el primer paciente queda cerrado como
      // atendido sin haber entrado. Esta recarga tambien recoge los eventos
      // que llegaron mientras la accion estaba en curso, y el nuevo plan de
      // "Retroceder".
      void recargar()
    }
  }

  // Se manda el paciente que el doctor VE abierto: si el servidor ya habia
  // llamado a otro (se perdio la respuesta), no llama a nadie mas ni cierra a
  // ese paciente por detras; devuelve el real y la pantalla se pone al dia.
  const llamarSiguiente = () =>
    ejecutar('llamar', async () => {
      const desenlace = await llamarSiguienteDesde(
        '/api/consultorio/llamar-siguiente',
        { moduloId },
        { ...SIN_LOGIN, turnoVisto: turnoActual },
      )
      setTurnoActual(desenlace.turno)
      if (desenlace.tipo === 'llamado') {
        toast.success('Paciente llamado', desenlace.turno.nombrePaciente ?? desenlace.turno.codigo)
      } else {
        toast.warning('Ya tenias un paciente llamado', avisoDePacienteYaLlamado(desenlace.turno))
      }
    })

  // El conteo visto evita que el reintento de una repeticion cuya respuesta se
  // perdio vuelva a sonar en la sala.
  const repetirLlamado = () =>
    ejecutar('repetir', async () => {
      if (!turnoActual) return
      const { turno } = await pedir<{ turno: Turno }>(`/api/consultorio/turnos/${turnoActual.id}/repetir`, {
        method: 'POST', ...SIN_LOGIN,
        body: JSON.stringify({ vecesLlamadoVisto: turnoActual.vecesLlamado }),
      })
      setTurnoActual(turno)
      toast.info('Llamado repetido', turno.nombrePaciente ?? turno.codigo)
    })

  const cerrarTurno = (tipo: 'atendido' | 'ausente') =>
    ejecutar(tipo, async () => {
      if (!turnoActual) return
      await pedir(`/api/consultorio/turnos/${turnoActual.id}/${tipo}`, { method: 'POST', ...SIN_LOGIN })
      toast[tipo === 'atendido' ? 'success' : 'warning'](
        tipo === 'atendido' ? 'Atencion finalizada' : 'Paciente ausente',
        turnoActual.nombrePaciente ?? turnoActual.codigo,
      )
      setTurnoActual(null)
    })

  /**
   * Retroceder al turno anterior.
   *
   * Se manda EXACTAMENTE lo que el doctor confirmo (quien vuelve a la fila y
   * quien vuelve a atencion): si el servidor ya esta en otro punto —el doble
   * clic, o un cambio desde otro equipo— responde 409 sin tocar nada, y la
   * recarga de `ejecutar` pone la pantalla al dia. Nunca retrocede un paso que
   * el doctor no vio.
   */
  const retroceder = () =>
    ejecutar('retroceder', async () => {
      const plan = retroceso
      if (!plan) return
      // SIN ESPERA: la pantalla muestra ya al paciente que vuelve (o ninguno),
      // con los datos que el servidor mismo dio en el plan. Si el servidor lo
      // rechaza, `ejecutar` avisa y la recarga pinta lo real.
      setConfirmandoRetroceso(false)
      setTurnoActual(
        plan.restaurar
          ? { ...plan.restaurar, estado: 'LLAMADO', cerradoEn: null, cerradoPor: null, cierreAutomatico: false, horaAtencion: null }
          : null,
      )
      if (plan.devolver) setPendientes((antes) => [plan.devolver as Turno, ...antes.filter((t) => t.id !== plan.devolver?.id)])
      try {
        const { restaurado, devuelto } = await pedir<{ restaurado: Turno | null; devuelto: Turno | null }>(
          '/api/consultorio/retroceder',
          {
            method: 'POST',
            ...SIN_LOGIN,
            body: JSON.stringify({ turnoAbiertoId: plan.devolver?.id ?? null, restaurarId: plan.restaurar?.id ?? null }),
          },
        )
        // Se pinta ya lo que devolvio el servidor, sin esperar la recarga.
        setTurnoActual(restaurado)
        setRetroceso(null)
        toast.success(
          'Listo, retrocediste',
          restaurado
            ? `${restaurado.codigo} volvio a atencion${devuelto ? ` y ${devuelto.codigo} a la fila de espera` : ''}.`
            : `${devuelto?.codigo ?? 'El paciente'} volvio a la fila de espera.`,
        )
      } finally {
        setConfirmandoRetroceso(false)
      }
    })

  const resumen = resumenDelDia(agenda)
  // El documento del paciente en atencion sale de su cita en la agenda de hoy.
  const documentoActual = turnoActual
    ? (agenda.find((item) => item.turnoId === turnoActual.id)?.documentoPaciente ?? null)
    : null
  // Sin consultorio asignado o sin pacientes en espera no hay a quien llamar:
  // el boton se apaga en vez de dejar que el doctor lo pulse y reciba un error.
  const puedeLlamar = Boolean(moduloId) && pendientes.length > 0

  if (cargando) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--turnos-bg)] px-6">
        <p className="animate-pulse text-sm font-semibold text-slate-500 motion-reduce:animate-none">
          Cargando tu consultorio...
        </p>
      </main>
    )
  }

  if (tokenInvalido) {
    return (
      <AvisoAPantallaCompleta
        tono="rojo"
        titulo="Este enlace ya no es valido"
        descripcion="Puede que haya vencido o que se haya generado uno nuevo. Si es asi, pide un enlace nuevo a la oficina de sistemas del hospital."
      >
        <ComprobarDeNuevo comprobando={comprobando} alComprobar={() => void comprobarAhora()} />
      </AvisoAPantallaCompleta>
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
    <main className="min-h-screen bg-[var(--turnos-bg)]">
      <EncabezadoConsultorio
        doctor={profesional.nombre}
        especialidad={servicio?.nombre ?? null}
        consultorio={consultorio?.nombre ?? null}
        conexion={conexion}
      />

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6 sm:py-7">
        {sinConexion ? (
          <Aviso tono="ambar" icono="alerta">
            Sin conexion con el servidor: lo que ves puede estar desactualizado. Se sigue intentando solo y se pone
            al dia en cuanto vuelva la conexion.
          </Aviso>
        ) : null}

        {!moduloId ? (
          <Aviso tono="rojo" icono="alerta">
            No tienes consultorio asignado en la agenda, asi que todavia no puedes llamar pacientes. Pide en admisiones
            o en sistemas que te lo asignen: es el que ve el paciente en la pantalla de la sala.
          </Aviso>
        ) : null}

        {/*
          Sin esto, un doctor con citas programadas pero sin nadie EN_ESPERA
          ve el boton apagado y cree que el sistema esta roto. El aviso explica
          que falta el paso de admisiones (registrar la llegada).
        */}
        {!turnoActual && pendientes.length === 0 && resumen.sinLlegar > 0 ? (
          <Aviso tono="azul" icono="info">
            Tienes {resumen.sinLlegar} {resumen.sinLlegar === 1 ? 'paciente' : 'pacientes'} en agenda para hoy;{' '}
            {resumen.sinLlegar === 1 ? 'aparecera' : 'apareceran'} para llamar cuando{' '}
            {resumen.sinLlegar === 1 ? 'registre' : 'registren'} su llegada en admisiones.
          </Aviso>
        ) : null}

        <TarjetaPaciente
          turno={turnoActual}
          documento={documentoActual}
          especialidad={servicio?.nombre ?? null}
          consultorio={consultorio?.nombre ?? null}
          enEspera={pendientes.length}
          etiquetaRetroceso={etiquetaDeRetroceso(retroceso)}
          retrocediendo={accion === 'retroceder'}
          ocupado={accion !== null}
          alRetroceder={() => setConfirmandoRetroceso(true)}
        />

        <BotonesDeAtencion
          accion={accion}
          hayPaciente={Boolean(turnoActual)}
          puedeLlamar={puedeLlamar}
          enEspera={pendientes.length}
          alLlamar={llamarSiguiente}
          alAtender={() => cerrarTurno('atendido')}
          alRepetir={repetirLlamado}
          alAusente={() => cerrarTurno('ausente')}
        />

        <AgendaDeHoy agenda={agenda} resumen={resumen} turnoActualId={turnoActual?.id ?? null} />
      </div>

      <ConfirmarRetroceso
        plan={retroceso}
        abierto={confirmandoRetroceso}
        cargando={accion === 'retroceder'}
        alCerrar={() => setConfirmandoRetroceso(false)}
        alConfirmar={retroceder}
      />
    </main>
  )
}

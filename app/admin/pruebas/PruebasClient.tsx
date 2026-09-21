'use client'

/**
 * Panel de pruebas: pone a los 10 profesionales sembrados a "atender" al
 * tiempo (genera sus accesos, registra la llegada de sus citas de hoy, y
 * llama pacientes en oleadas) para poder ver en vivo, en la misma pantalla,
 * como reacciona /pantalla. Pensado para demos y para detectar problemas de
 * la pantalla publica bajo varios consultorios activos, no para produccion.
 */

import { useCallback, useRef, useState } from 'react'
import {
  ArrowClockwise,
  Broadcast,
  FastForward,
  Megaphone,
  PlayCircle,
  Stop,
  Warning,
} from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { Campo, Entrada } from '@/components/admin/Campos'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import type { HorarioDia, ItemAgendaProfesional, Modulo, Profesional, Turno } from '@/lib/turnos/types'

/**
 * Cuantos consultorios se simulan como maximo.
 *
 * Es un tope de la PANTALLA, no del sistema: con veinte tarjetas el panel deja
 * de caber y la oleada tarda tanto que no se ve lo que se queria ver. Los
 * doctores salen de la agenda real del dia (ver `doctoresSimulablesDeHoy`).
 */
const MAXIMO_CONSULTORIOS_SIMULADOS = 10

/** Pacientes ficticios para rellenar la agenda cuando ya se gastaron las citas sembradas. */
const NOMBRES_SIMULACION = [
  'Ana Maria Ortega Ruiz',
  'Luis Fernando Pardo Melo',
  'Claudia Patricia Nieto Sanz',
  'Andres Felipe Guzman Rey',
  'Marcela Andrea Pineda Cruz',
  'Oscar Ivan Zapata Uribe',
  'Laura Sofia Bernal Mesa',
  'Hernan Dario Cuesta Polo',
  'Yuranis Paola Meza Ariza',
  'Kevin Steven Aguilar Cano',
]

function pacienteSimulado(indice: number) {
  return {
    nombrePaciente: NOMBRES_SIMULACION[indice % NOMBRES_SIMULACION.length],
    documentoPaciente: String(90000000 + Math.floor(Math.random() * 9999999)),
  }
}

/**
 * Los doctores que HOY se pueden simular, con las horas que tienen libres.
 *
 * LOS DOCTORES SALEN DE LA AGENDA REAL, NO DE UNA LISTA ESCRITA A MANO. Antes
 * habia aqui diez identificadores fijos —'pro-perez', 'pro-gomez'...— que son
 * los del catalogo de ejemplo con el que se desarrolla. En el hospital de
 * verdad los doctores entran con la carga del reporte y llevan otros
 * identificadores, asi que NINGUNO de esos diez existia: la simulacion fallaba
 * en el primer paso, doctor por doctor, con "el profesional indicado no
 * existe", y el panel quedaba vacio sin explicar por que.
 *
 * Salen del horario del dia por dos razones. La primera es que asi son
 * siempre los del hospital que este montado, sin nada que actualizar a mano.
 * La segunda es que el horario es EXACTAMENTE lo que el servidor va a aceptar
 * despues: si un doctor tiene columna ahi, se le puede agendar; si no la
 * tiene, no. Pedir los doctores por un lado y las horas por otro era abrir la
 * puerta a que las dos listas no coincidieran.
 *
 * Se quedan fuera los que no tienen ni un cupo libre: no se les podria sembrar
 * un paciente y su tarjeta apareceria en cero.
 */
async function doctoresSimulablesDeHoy(fecha: string): Promise<{
  doctores: { profesionalId: string; nombre: string }[]
  libres: Map<string, string[]>
}> {
  const { horario } = await pedir<{ horario: HorarioDia }>(`/api/turnos/agenda/horario?fecha=${fecha}`)
  const libres = new Map<string, string[]>()
  const nombres = new Map<string, string>()

  for (const bloque of horario.bloques) {
    for (const columna of bloque.columnas) {
      nombres.set(columna.profesionalId, columna.profesionalNombre)
      // Solo franjas de la configuracion: en las horas sueltas que trae la
      // agenda del hospital (7:09) el servidor no deja agendar.
      const horas = bloque.filas
        .filter((fila) => fila.agendable && !bloque.citas[`${columna.profesionalId}|${fila.hora}`])
        .map((fila) => fila.hora)
      libres.set(columna.profesionalId, [...(libres.get(columna.profesionalId) ?? []), ...horas])
    }
  }

  const doctores = [...nombres.entries()]
    .filter(([id]) => (libres.get(id)?.length ?? 0) > 0)
    .slice(0, MAXIMO_CONSULTORIOS_SIMULADOS)
    .map(([profesionalId, nombre]) => ({ profesionalId, nombre }))

  return { doctores, libres }
}

/**
 * Instante ISO de una franja de hoy EN COLOMBIA. El desfase va a mano porque
 * el equipo puede estar en otra zona y la cita caeria en el dia equivocado.
 */
function instanteDeFranja(fecha: string, hora: string) {
  return new Date(`${fecha}T${hora}:00-05:00`).toISOString()
}

type DoctorSimulado = {
  profesionalId: string
  nombre: string
  moduloId: string
  moduloNombre: string
  token: string
  pacientesEnEspera: number
  turnoActual: Turno | null
  llamando: boolean
}

/**
 * @param habilitada Si ESTE servidor deja correr la simulacion (lo decide
 *   `simulacionHabilitada()` en el servidor, ver `page.tsx`). En falso, el
 *   panel se muestra entero pero apagado y explicado: antes ofrecia los
 *   botones, pedia una confirmacion en rojo para "borrar el dia" y recien
 *   entonces el servidor respondia 403, con lo que parecia una falla del
 *   sistema y no una proteccion puesta a proposito.
 */
export default function PruebasClient({ habilitada }: { habilitada: boolean }) {
  const [doctores, setDoctores] = useState<DoctorSimulado[]>([])
  const [preparando, setPreparando] = useState(false)
  const [enOleada, setEnOleada] = useState(false)
  const [pacientesPorConsultorio, setPacientesPorConsultorio] = useState(3)
  const [tamanoOleada, setTamanoOleada] = useState(2)
  const [pausaSegundos, setPausaSegundos] = useState(4)
  const [log, setLog] = useState<string[]>([])
  // Preparar la simulacion borra los turnos de hoy y devuelve las citas a
  // PROGRAMADA, sean de ejemplo o de verdad. Nunca debe pasar por un solo clic.
  const [confirmarReinicio, setConfirmarReinicio] = useState(false)
  /**
   * Cuantas citas hay hoy de verdad, para el aviso de reinicio.
   *
   * `null` mientras se averigua o si no se pudo. El aviso decia siempre "se
   * van a borrar todas las citas y todos los turnos de hoy" en rojo, tambien
   * los dias en los que no hay ni una: daba miedo sin motivo y hacia dudar de
   * si la pantalla estaba fallando. Y ademas no era cierto contra la base de
   * verdad, que no borra ni una cita (ver `reiniciarDatosDeHoy` en el
   * repositorio de Prisma). Decir el numero, y decir lo que de verdad pasa,
   * convierte un susto en una decision informada.
   */
  const [citasQueSeBorran, setCitasQueSeBorran] = useState<number | null>(null)
  const detenerRef = useRef(false)

  const agregarLog = useCallback((linea: string) => {
    const hora = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
      new Date(),
    )
    setLog((prev) => [...prev.slice(-79), `${hora}  ${linea}`])
  }, [])

  /** Abre la confirmacion y, mientras, averigua que hay hoy que perder. */
  async function pedirConfirmacion() {
    setCitasQueSeBorran(null)
    setConfirmarReinicio(true)

    try {
      const { horario } = await pedir<{ horario: HorarioDia }>(
        `/api/turnos/agenda/horario?fecha=${hoyEnColombia()}`,
      )
      const enParrilla = horario.bloques.reduce(
        (total, bloque) => total + bloque.columnas.reduce((suma, columna) => suma + columna.citas, 0),
        0,
      )
      setCitasQueSeBorran(enParrilla + horario.fueraDeHorario.length)
    } catch {
      // No se pudo saber: se queda el aviso generico, que es el prudente.
      setCitasQueSeBorran(null)
    }
  }

  async function prepararSimulacion() {
    detenerRef.current = false
    setPreparando(true)
    setDoctores([])
    setLog([])
    agregarLog('Reiniciando los datos del dia...')

    // Se arranca de cero: los turnos de hoy se borran y las citas de ejemplo
    // vuelven a quedar PROGRAMADA. Sin esto, la segunda corrida encuentra
    // todas las citas ya usadas y los consultorios quedan en 0 pacientes.
    try {
      await pedir('/api/turnos/simulacion', { method: 'POST' })
      agregarLog('Datos del dia reiniciados.')
    } catch (error) {
      agregarLog(`No se pudieron reiniciar los datos del dia: ${mensajeDeError(error) ?? 'error desconocido'}`)
      setPreparando(false)
      return
    }

    const hoy = hoyEnColombia()

    // Quienes se pueden simular hoy y con que horas, sacado de la agenda real.
    let doctoresDelDia: { profesionalId: string; nombre: string }[]
    let libresPorDoctor: Map<string, string[]>
    try {
      const encontrados = await doctoresSimulablesDeHoy(hoy)
      doctoresDelDia = encontrados.doctores
      libresPorDoctor = encontrados.libres
    } catch (error) {
      agregarLog(`No se pudo leer el horario del dia: ${mensajeDeError(error) ?? 'error desconocido'}`)
      setPreparando(false)
      return
    }

    /*
      SIN DOCTORES NO HAY SIMULACION, Y HAY QUE DECIR POR QUE.

      Pasa cuando el hospital no tiene doctores activos en servicios que
      atiendan por cita, o cuando la configuracion de jornadas no deja ni una
      franja libre. Antes esto se veia como un panel vacio sin una sola linea
      en el registro, que es la peor forma de fallar: parece que la pantalla
      esta rota.
    */
    if (doctoresDelDia.length === 0) {
      agregarLog(
        'No hay ningun doctor al que se le pueda sembrar un paciente hoy. Revisa que existan ' +
          'profesionales activos en un servicio que atienda POR CITA, y que su jornada tenga ' +
          'franjas libres (Pantalla y audio define las horas de cada jornada).',
      )
      setPreparando(false)
      return
    }

    agregarLog(
      `Preparando ${doctoresDelDia.length} consultorio(s) con ${pacientesPorConsultorio} paciente(s) cada uno...`,
    )

    for (const [indiceDoctor, { profesionalId }] of doctoresDelDia.entries()) {
      if (detenerRef.current) break
      try {
        const { url } = await pedir<{ url: string; expiraEn: string }>(`/api/profesionales/${profesionalId}/acceso`, {
          method: 'POST',
          body: JSON.stringify({ horas: 2, minutos: 0 }),
        })
        const token = url.split('/consultorio/')[1]

        const leerEstado = () =>
          pedir<{
            profesional: Profesional
            modulos: Modulo[]
            agenda: ItemAgendaProfesional[]
            pendientes: Turno[]
            turnoActual: Turno | null
          }>(`/api/consultorio?fecha=${hoy}`, { headers: { 'x-consultorio-token': token } })

        let estado = await leerEstado()
        let porLlegar = estado.agenda.filter((item) => item.estado === 'PROGRAMADA')

        // Las citas sembradas son solo 2 o 3 por profesional: se agregan las
        // que falten para llegar al numero de pacientes pedido.
        const faltantes = pacientesPorConsultorio - porLlegar.length
        if (faltantes > 0) {
          const libres = libresPorDoctor.get(profesionalId) ?? []
          let agregadas = 0
          for (let i = 0; i < faltantes; i += 1) {
            if (detenerRef.current) break

            // Cada franja se usa una sola vez: se saca de la lista al pedirla.
            const hora = libres.shift()
            if (!hora) {
              agregarLog(`${profesionalId} ya no tiene cupos libres en su jornada de hoy.`)
              break
            }

            try {
              await pedir('/api/turnos/agenda', {
                method: 'POST',
                body: JSON.stringify({
                  ...pacienteSimulado(indiceDoctor * pacientesPorConsultorio + i),
                  profesionalId,
                  horaCita: instanteDeFranja(hoy, hora),
                }),
              })
              agregadas += 1
            } catch (error) {
              agregarLog(`No se pudieron agregar mas citas: ${mensajeDeError(error) ?? 'error desconocido'}`)
              break
            }
          }
          if (agregadas > 0) {
            estado = await leerEstado()
            porLlegar = estado.agenda.filter((item) => item.estado === 'PROGRAMADA')
          }
        }

        // Registrar la llegada es lo que convierte la cita en un turno EN_ESPERA.
        for (const item of porLlegar.slice(0, pacientesPorConsultorio)) {
          if (detenerRef.current) break
          try {
            await pedir('/api/turnos/citas/llegada', { method: 'POST', body: JSON.stringify({ citaId: item.citaId }) })
          } catch (error) {
            agregarLog(`No se pudo registrar la llegada de ${item.nombrePaciente}: ${mensajeDeError(error) ?? 'error desconocido'}`)
          }
        }

        // La fila real la manda el servidor, no la cuenta local.
        estado = await leerEstado()

        const moduloId = estado.profesional.moduloId ?? estado.modulos[0]?.id ?? ''
        const moduloNombre = estado.modulos.find((m) => m.id === moduloId)?.nombre ?? '—'
        const enEspera = estado.pendientes.length

        const doctor: DoctorSimulado = {
          profesionalId,
          nombre: estado.profesional.nombre,
          moduloId,
          moduloNombre,
          token,
          pacientesEnEspera: enEspera,
          turnoActual: estado.turnoActual,
          llamando: false,
        }
        setDoctores((prev) => [...prev, doctor])
        agregarLog(`${doctor.nombre} listo en ${moduloNombre} — ${enEspera} paciente(s) en espera.`)
      } catch (error) {
        agregarLog(`No se pudo preparar ${profesionalId}: ${mensajeDeError(error) ?? 'error desconocido'}`)
      }
    }

    if (!detenerRef.current) {
      agregarLog('Listo. Ya puedes llamar pacientes, uno por uno o en oleadas para todos.')
    }
    setPreparando(false)
  }

  const llamarUno = useCallback(
    async (doctor: DoctorSimulado) => {
      setDoctores((prev) => prev.map((d) => (d.profesionalId === doctor.profesionalId ? { ...d, llamando: true } : d)))
      try {
        /*
          LA SIMULACION MANDA EL TOKEN EN UNA CABECERA, NO EN LA RUTA.

          El doctor de verdad entra con cookie (ver `proxy.ts`), pero este
          panel hace de ocho doctores a la vez desde una sola pestaña y una
          cookie no puede ser ocho cosas. La cabecera sirve para las dos cosas
          que importan: no aparece en el registro de peticiones del servidor
          —que era el problema— y deja que cada llamada diga de que doctor es.
        */
        const { turno } = await pedir<{ turno: Turno }>('/api/consultorio/llamar-siguiente', {
          method: 'POST',
          headers: { 'x-consultorio-token': doctor.token },
          body: JSON.stringify({ moduloId: doctor.moduloId }),
        })
        agregarLog(`${doctor.nombre} llamo a ${turno.codigo}${turno.nombrePaciente ? ` — ${turno.nombrePaciente}` : ''}.`)
        setDoctores((prev) =>
          prev.map((d) =>
            d.profesionalId === doctor.profesionalId
              ? { ...d, llamando: false, turnoActual: turno, pacientesEnEspera: Math.max(0, d.pacientesEnEspera - 1) }
              : d,
          ),
        )
      } catch (error) {
        agregarLog(`${doctor.nombre}: ${mensajeDeError(error) ?? 'sin pacientes en espera'}.`)
        setDoctores((prev) => prev.map((d) => (d.profesionalId === doctor.profesionalId ? { ...d, llamando: false } : d)))
      }
    },
    [agregarLog],
  )

  function esperar(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function siguienteParaTodos() {
    setEnOleada(true)
    detenerRef.current = false
    agregarLog(`Llamando a todos en oleadas de ${tamanoOleada}...`)

    for (let i = 0; i < doctores.length; i += tamanoOleada) {
      if (detenerRef.current) break
      const oleada = doctores.slice(i, i + tamanoOleada)
      await Promise.all(oleada.map((doctor) => llamarUno(doctor)))
      if (detenerRef.current) break
      if (i + tamanoOleada < doctores.length) await esperar(pausaSegundos * 1000)
    }

    setEnOleada(false)
  }

  function detenerSimulacion() {
    detenerRef.current = true
    setEnOleada(false)
    setPreparando(false)
    setDoctores([])
    agregarLog('Simulacion detenida.')
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_26rem] xl:items-start">
      <div className="space-y-5">
        {!habilitada && (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <Warning size={20} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
            <div className="space-y-2 text-sm leading-6 text-amber-900">
              <p className="font-semibold">La simulacion esta apagada en este servidor.</p>
              <p>
                Este es el servidor con la agenda real del hospital. La simulacion rehace los turnos del dia
                y les cambia el enlace a los doctores, asi que aqui queda cerrada a proposito: no es una
                falla.
              </p>
              <p>
                Para mostrarla, entra al servidor de demostracion, que tiene el mismo sistema y una base
                aparte con pacientes de mentira. Se enciende con{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">TURNOS_SIMULACION=1</code>
                .
              </p>
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Controles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-slate-600">
              Primero prepara la simulacion: toma los doctores que hoy pueden atender (hasta{' '}
              {MAXIMO_CONSULTORIOS_SIMULADOS}), le genera a cada uno un acceso temporal y registra la llegada
              de las citas de hoy, creando las que falten para llegar al numero de pacientes que elijas. Luego
              llama pacientes uno por uno desde cada tarjeta, o dale a &quot;Siguiente para todos&quot; para que
              vayan pasando en oleadas.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void pedirConfirmacion()}
                loading={preparando}
                disabled={!habilitada || enOleada}
              >
                <PlayCircle size={18} weight="bold" />
                {doctores.length > 0 ? 'Volver a preparar' : 'Preparar simulacion'}
              </Button>
              <Button
                variant="dark"
                onClick={siguienteParaTodos}
                loading={enOleada}
                disabled={!habilitada || preparando || doctores.length === 0}
              >
                <FastForward size={18} weight="bold" />
                Siguiente para todos
              </Button>
              <Button
                variant="danger"
                onClick={detenerSimulacion}
                disabled={!habilitada || (!preparando && !enOleada && doctores.length === 0)}
              >
                <Stop size={18} weight="bold" />
                Detener simulacion
              </Button>
              <a href="/pantalla" target="_blank" rel="noreferrer" className="ml-auto">
                <Button variant="secondary" type="button">
                  <Broadcast size={18} weight="bold" />
                  Abrir pantalla aparte
                </Button>
              </a>
            </div>
            <div className="flex flex-wrap gap-4 border-t border-slate-100 pt-4">
              <Campo etiqueta="Pacientes por consultorio" className="max-w-[12rem]">
                <Entrada
                  type="number"
                  min={1}
                  max={20}
                  value={pacientesPorConsultorio}
                  onChange={(e) =>
                    setPacientesPorConsultorio(Math.min(20, Math.max(1, Number(e.target.value) || 1)))
                  }
                  disabled={preparando}
                />
              </Campo>
              <Campo etiqueta="Tamano de la oleada" className="max-w-[10rem]">
                <Entrada
                  type="number"
                  min={1}
                  max={10}
                  value={tamanoOleada}
                  onChange={(e) => setTamanoOleada(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                />
              </Campo>
              <Campo etiqueta="Pausa entre oleadas (s)" className="max-w-[10rem]">
                <Entrada
                  type="number"
                  min={1}
                  max={30}
                  value={pausaSegundos}
                  onChange={(e) => setPausaSegundos(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
                />
              </Campo>
            </div>
          </CardContent>
        </Card>

        {doctores.length > 0 ? (
          <Card padded={false}>
            <CardHeader>
              <CardTitle>Consultorios ({doctores.length})</CardTitle>
            </CardHeader>
            <CardContent padded={false}>
              <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
                {doctores.map((doctor) => (
                  <div key={doctor.profesionalId} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-brand-950">{doctor.nombre}</p>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          {doctor.moduloNombre}
                        </p>
                      </div>
                      <Badge tone={doctor.pacientesEnEspera > 0 ? 'blue' : 'slate'}>
                        {doctor.pacientesEnEspera} en espera
                      </Badge>
                    </div>
                    <p className="mt-2 truncate text-sm text-slate-600">
                      {doctor.turnoActual
                        ? `Atendiendo ${doctor.turnoActual.codigo}${doctor.turnoActual.nombrePaciente ? ` — ${doctor.turnoActual.nombrePaciente}` : ''}`
                        : 'Sin paciente en atencion.'}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-3 w-full"
                      onClick={() => llamarUno(doctor)}
                      loading={doctor.llamando}
                      disabled={enOleada}
                    >
                      <Megaphone size={16} weight="bold" />
                      Siguiente paciente
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card padded={false}>
          <CardHeader>
            <CardTitle>Registro</CardTitle>
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <p className="text-sm text-slate-500">Aqui se van a ver los pasos de la simulacion.</p>
            ) : (
              <ol className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs leading-6 text-slate-600">
                {log.map((linea, i) => (
                  <li key={i}>{linea}</li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card padded={false} className="xl:sticky xl:top-5">
        <CardHeader>
          <CardTitle>Pantalla en vivo</CardTitle>
        </CardHeader>
        <CardContent padded={false}>
          <p className="px-5 pt-4 text-xs leading-5 text-slate-500">
            La primera vez, dale clic a &quot;Activar pantalla&quot; adentro (el navegador exige un clic para poder
            sonar el audio).
          </p>
          <div className="p-5">
            <iframe
              src="/pantalla"
              title="Pantalla de sala de espera"
              className="h-[520px] w-full rounded-xl border border-slate-200"
            />
          </div>
        </CardContent>
      </Card>

      <ConfirmModal
        open={confirmarReinicio}
        onClose={() => setConfirmarReinicio(false)}
        onConfirm={() => {
          setConfirmarReinicio(false)
          void prepararSimulacion()
        }}
        title="Esto rehace la jornada de hoy"
        description="Preparar la simulacion vacia la sala de espera antes de empezar."
        confirmLabel="Rehacer el dia y preparar"
        danger
      >
        {citasQueSeBorran === null ? (
          <p className="text-sm leading-6 text-slate-600">
            Se van a <strong className="font-semibold text-red-700">borrar todos los turnos de hoy</strong> y
            a deshacer el registro de llegada de los pacientes que ya esten en la fila. Las citas no se
            borran: vuelven a quedar como PROGRAMADA.
          </p>
        ) : citasQueSeBorran === 0 ? (
          <p className="text-sm leading-6 text-slate-600">
            Hoy <strong className="font-semibold">no hay ninguna cita cargada</strong>, asi que no se
            interrumpe a nadie. Se borran los turnos que haya podido dejar una prueba anterior y se agregan
            pacientes de mentira para la simulacion.
          </p>
        ) : (
          <p className="text-sm leading-6 text-slate-600">
            Hoy hay <strong className="font-semibold text-red-700">{citasQueSeBorran} cita(s)</strong>: se
            borran sus turnos y las que ya se hayan presentado vuelven a quedar como PROGRAMADA, o sea que
            el mostrador tendria que registrarles la llegada otra vez. Las citas en si no se borran.
          </p>
        )}
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Tambien se generan enlaces nuevos para los doctores que entren en la simulacion, con lo que{' '}
          <strong className="font-semibold">se invalidan los enlaces que esten usando ahora</strong>.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Esta pantalla es solo para demos y pruebas de carga. No la uses en un dia de atencion real.
        </p>
      </ConfirmModal>
    </div>
  )
}

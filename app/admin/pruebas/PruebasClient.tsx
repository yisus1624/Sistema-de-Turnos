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
import { llamarSiguienteDesde } from '@/lib/api/llamado-cliente'
import type { HorarioDia, Turno } from '@/lib/turnos/types'
import { MAXIMO_CONSULTORIOS_SIMULADOS, type SimulacionPreparada } from '@/lib/turnos/simulacion-carga'

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
  const [consultoriosASimular, setConsultoriosASimular] = useState(10)
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
    agregarLog(`Preparando ${consultoriosASimular} consultorios con ${pacientesPorConsultorio} paciente(s) cada uno...`)

    /*
      TODO EN EL SERVIDOR, EN UNA SOLA PETICION.

      Antes este panel hacia, por cada doctor, diez o quince peticiones
      seguidas (enlace, estado, citas de relleno, llegadas...). Con la base
      remota se quedaba en "Preparando..." y no dejaba pulsar "Siguiente para
      todos". Ahora el servidor reinicia el dia, usa las citas que YA existen
      (las de hoy o, si no hay, las del ultimo dia con citas), registra las
      llegadas, reparte un consultorio distinto a cada doctor y devuelve todo.
    */
    try {
      const preparada = await pedir<SimulacionPreparada>('/api/turnos/simulacion', {
        method: 'POST',
        body: JSON.stringify({ pacientesPorConsultorio, consultorios: consultoriosASimular }),
        // Quince consultorios con varios pacientes, uno por uno contra la base
        // remota, pueden tardar mas de un minuto.
        msLimite: 240_000,
      })
      for (const aviso of preparada.avisos) agregarLog(aviso)
      if (detenerRef.current) return

      setDoctores(preparada.doctores.map((doctor) => ({ ...doctor, turnoActual: null, llamando: false })))
      for (const doctor of preparada.doctores) {
        agregarLog(`${doctor.nombre} listo en ${doctor.moduloNombre} — ${doctor.pacientesEnEspera} paciente(s) en espera.`)
      }
      if (preparada.doctores.length > 0) {
        agregarLog('Listo. Ya puedes llamar pacientes, uno por uno o en oleadas para todos.')
      }
    } catch (error) {
      agregarLog(`No se pudo preparar la simulacion: ${mensajeDeError(error) ?? 'error desconocido'}`)
    } finally {
      setPreparando(false)
    }
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
        // El mismo camino que la pantalla del doctor (`llamarSiguienteDesde`):
        // manda el turno que este doctor simulado tiene abierto y, si el
        // servidor ya tenia otro (409), lo adopta en vez de fallar.
        const desenlace = await llamarSiguienteDesde(
          '/api/consultorio/llamar-siguiente',
          { moduloId: doctor.moduloId },
          { headers: { 'x-consultorio-token': doctor.token }, turnoVisto: doctor.turnoActual ?? null },
        )
        const { turno } = desenlace
        if (desenlace.tipo === 'ya_tenia_uno') {
          agregarLog(`${doctor.nombre}: ya tenia llamado el ${turno.codigo}; se toma ese.`)
          setDoctores((prev) =>
            prev.map((d) => (d.profesionalId === doctor.profesionalId ? { ...d, llamando: false, turnoActual: turno } : d)),
          )
          return
        }
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

  async function detenerSimulacion() {
    detenerRef.current = true
    setEnOleada(false)
    setPreparando(false)
    setDoctores([])
    agregarLog('Deteniendo: se limpian los turnos de hoy...')
    // Deja el dia en blanco (y borra consultorios temporales de versiones
    // anteriores de la simulacion, si quedo alguno).
    try {
      const { consultoriosBorrados } = await pedir<{ consultoriosBorrados: number }>('/api/turnos/simulacion', {
        method: 'DELETE',
        msLimite: 60_000,
      })
      agregarLog(consultoriosBorrados > 0 ? `Simulacion detenida. Se borraron ${consultoriosBorrados} consultorios temporales viejos.` : 'Simulacion detenida.')
    } catch (error) {
      agregarLog(`No se pudo limpiar la simulacion: ${mensajeDeError(error) ?? 'error desconocido'}`)
    }
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
              Elige cuantos consultorios quieres ver en la pantalla (hasta {MAXIMO_CONSULTORIOS_SIMULADOS}) y
              prepara la simulacion: usa las citas que ya existen (las de hoy y, si no alcanzan, las del ultimo
              dia con citas) y registra la llegada de sus pacientes, sin crear pacientes ni citas. Cada doctor
              llama desde su consultorio real: varios pueden compartir el mismo y cada uno sale en su fila de
              la pantalla. Luego llama pacientes uno por uno desde cada tarjeta, o dale a
              &quot;Siguiente para todos&quot; para que vayan pasando en oleadas.
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
              <Campo etiqueta="Consultorios a simular" className="max-w-[12rem]">
                <Entrada
                  type="number"
                  min={1}
                  max={MAXIMO_CONSULTORIOS_SIMULADOS}
                  value={consultoriosASimular}
                  onChange={(e) =>
                    setConsultoriosASimular(
                      Math.min(MAXIMO_CONSULTORIOS_SIMULADOS, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                  disabled={preparando}
                />
              </Campo>
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
            Si adentro aparece &quot;Sonido desactivado: toca para activar&quot;, toca el aviso para oir los
            llamados (el navegador exige un toque para sonar).
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

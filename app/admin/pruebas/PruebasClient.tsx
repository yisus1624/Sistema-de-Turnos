'use client'

/**
 * Panel de pruebas: pone a los 10 profesionales sembrados a "atender" al
 * tiempo (genera sus accesos, registra la llegada de sus citas de hoy, y
 * llama pacientes en oleadas) para poder ver en vivo, en la misma pantalla,
 * como reacciona /pantalla. Pensado para demos y para detectar problemas de
 * la pantalla publica bajo varios consultorios activos, no para produccion.
 */

import { useCallback, useRef, useState } from 'react'
import { ArrowClockwise, Broadcast, FastForward, Megaphone, PlayCircle, Stop } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { Campo, Entrada } from '@/components/admin/Campos'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import type { HorarioDia, ItemAgendaProfesional, Modulo, Profesional, Turno } from '@/lib/turnos/types'

const PROFESIONALES_SIMULACION = [
  'pro-perez',
  'pro-gomez',
  'pro-salas',
  'pro-rios',
  'pro-torres',
  'pro-mejia',
  'pro-vega',
  'pro-lopez',
  'pro-ramirez',
  'pro-castro',
]

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
 * Franjas que tiene libres cada doctor hoy, sacadas del horario REAL.
 *
 * La simulacion no puede inventarse las horas: una cita solo entra si cae en
 * una franja de la jornada de ese doctor y el cupo esta libre. Se pide el
 * horario una sola vez, despues de reiniciar el dia, y de ahi salen las horas
 * que se van repartiendo.
 */
async function franjasLibresPorDoctor(fecha: string): Promise<Map<string, string[]>> {
  const { horario } = await pedir<{ horario: HorarioDia }>(`/api/turnos/agenda/horario?fecha=${fecha}`)
  const libres = new Map<string, string[]>()

  for (const bloque of horario.bloques) {
    for (const columna of bloque.columnas) {
      // Solo franjas de la configuracion: en las horas sueltas que trae la
      // agenda del hospital (7:09) el servidor no deja agendar.
      const horas = bloque.filas
        .filter((fila) => fila.agendable && !bloque.citas[`${columna.profesionalId}|${fila.hora}`])
        .map((fila) => fila.hora)
      libres.set(columna.profesionalId, [...(libres.get(columna.profesionalId) ?? []), ...horas])
    }
  }

  return libres
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

export default function PruebasClient() {
  const [doctores, setDoctores] = useState<DoctorSimulado[]>([])
  const [preparando, setPreparando] = useState(false)
  const [enOleada, setEnOleada] = useState(false)
  const [pacientesPorConsultorio, setPacientesPorConsultorio] = useState(3)
  const [tamanoOleada, setTamanoOleada] = useState(2)
  const [pausaSegundos, setPausaSegundos] = useState(4)
  const [log, setLog] = useState<string[]>([])
  // Preparar la simulacion BORRA las citas y los turnos de hoy, sean de
  // ejemplo o de verdad. Nunca debe pasar por un solo clic.
  const [confirmarReinicio, setConfirmarReinicio] = useState(false)
  const detenerRef = useRef(false)

  const agregarLog = useCallback((linea: string) => {
    const hora = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
      new Date(),
    )
    setLog((prev) => [...prev.slice(-79), `${hora}  ${linea}`])
  }, [])

  async function prepararSimulacion() {
    detenerRef.current = false
    setPreparando(true)
    setDoctores([])
    setLog([])
    agregarLog(
      `Preparando ${PROFESIONALES_SIMULACION.length} consultorios con ${pacientesPorConsultorio} paciente(s) cada uno...`,
    )

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

    // Las horas libres de cada doctor, para poder agendarle mas pacientes sin
    // chocar con la parrilla ni con las citas de ejemplo que acaba de sembrar
    // el reinicio.
    let libresPorDoctor: Map<string, string[]>
    try {
      libresPorDoctor = await franjasLibresPorDoctor(hoy)
    } catch (error) {
      agregarLog(`No se pudo leer el horario del dia: ${mensajeDeError(error) ?? 'error desconocido'}`)
      setPreparando(false)
      return
    }

    for (const [indiceDoctor, profesionalId] of PROFESIONALES_SIMULACION.entries()) {
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
          }>(`/api/consultorio/${token}?fecha=${hoy}`)

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
        const { turno } = await pedir<{ turno: Turno }>(`/api/consultorio/${doctor.token}/llamar-siguiente`, {
          method: 'POST',
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
        <Card>
          <CardHeader>
            <CardTitle>Controles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-slate-600">
              Primero prepara la simulacion: genera un acceso temporal para cada uno de los 10 profesionales
              sembrados y registra la llegada de las citas de hoy (crea las que falten para llegar al numero de
              pacientes que elijas), para que tengan pacientes en espera. Luego llama
              pacientes uno por uno desde cada tarjeta, o dale a &quot;Siguiente para todos&quot; para que vayan
              pasando en oleadas.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setConfirmarReinicio(true)} loading={preparando} disabled={enOleada}>
                <PlayCircle size={18} weight="bold" />
                {doctores.length > 0 ? 'Volver a preparar' : 'Preparar simulacion'}
              </Button>
              <Button
                variant="dark"
                onClick={siguienteParaTodos}
                loading={enOleada}
                disabled={preparando || doctores.length === 0}
              >
                <FastForward size={18} weight="bold" />
                Siguiente para todos
              </Button>
              <Button
                variant="danger"
                onClick={detenerSimulacion}
                disabled={!preparando && !enOleada && doctores.length === 0}
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
                        <p className="font-black text-brand-950">{doctor.nombre}</p>
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
        title="Esto borra la jornada de hoy"
        description="Preparar la simulacion deja el dia en blanco antes de empezar."
        confirmLabel="Borrar el dia y preparar"
        danger
      >
        <p className="text-sm leading-6 text-slate-600">
          Se van a <strong className="font-black text-red-700">borrar todas las citas y todos los turnos de
          hoy</strong>, incluidos los que haya cargado el mostrador y los pacientes que ya esten en la fila.
          Tambien se generan enlaces nuevos para los 10 doctores de ejemplo, con lo que{' '}
          <strong className="font-black">se invalidan los enlaces que esten usando ahora</strong>.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Esta pantalla es solo para demos y pruebas de carga. No la uses en un dia de atencion real.
        </p>
      </ConfirmModal>
    </div>
  )
}

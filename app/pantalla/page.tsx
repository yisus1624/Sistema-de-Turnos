'use client'

/**
 * Pantalla de visualizacion para los usuarios (requerimiento seccion 10).
 *
 * Sin autenticacion a proposito: se abre en el televisor de la sala de espera.
 * Todo lo que llega aqui viene ya enmascarado desde el servidor.
 *
 * DISEÑO: el turno NO se pasa solo, lo pasa el doctor o el operador al pulsar
 * "siguiente". Por eso esta pantalla NO rota nada por tiempo: pinta una
 * cuadricula con UNA CASILLA FIJA POR MODULO (consultorio o ventanilla) y esa
 * casilla solo cambia cuando llega el evento de ese modulo puntual. Si hay 4
 * doctores atendiendo se ven los 4 a la vez; si hay 10, se ven los 10. Nunca
 * desaparece una casilla por el paso del tiempo, solo cuando el modulo queda
 * libre o vuelve a llamar.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, SpeakerHigh, SpeakerX, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import type { EventoTurno } from '@/lib/realtime/hub'
import type { CasillaPantalla, ConfiguracionPantalla } from '@/lib/turnos/types'
import {
  ColaDeAnuncios,
  alCargarVoces,
  elegirVoz,
  esVozColombiana,
  locutorNavegador,
  sonarCampana,
  textoAnuncio,
} from '@/lib/turnos/anuncio'
import { Isotipo, NOMBRE_INSTITUCION, NOMBRE_SISTEMA } from '@/components/brand/Marca'

/** Cuanto dura el resalte visual de la casilla recien llamada, en milisegundos. */
const MS_RESALTE = 8000

const CONFIGURACION_POR_DEFECTO: ConfiguracionPantalla = {
  audioActivo: true,
  repeticionesAudio: 2,
  volumen: 1,
  ultimosVisibles: 5,
  mensajePie: '',
  maxCitasPorProfesional: 20,
}

/** Una casilla "libre" (sin turno) para reponer un modulo cuando se libera. */
function casillaLibreDesde(casilla: CasillaPantalla): CasillaPantalla {
  return {
    ...casilla,
    turnoId: null,
    codigo: null,
    pacienteVisible: null,
    horaLlamado: null,
    vecesLlamado: 0,
  }
}

function Reloj() {
  const [ahora, setAhora] = useState<Date | null>(null)

  useEffect(() => {
    setAhora(new Date())
    const id = setInterval(() => setAhora(new Date()), 15000)
    return () => clearInterval(id)
  }, [])

  if (!ahora) return null

  const hora = new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(ahora)
  const fecha = new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(ahora)

  return (
    <div className="flex items-center gap-3">
      <Clock size={38} weight="thin" className="text-slate-400" />
      <div className="leading-tight">
        <p className="text-2xl font-bold tabular-nums text-slate-700">{hora}</p>
        <p className="text-sm font-bold text-slate-500">{fecha}</p>
      </div>
    </div>
  )
}

/** Una casilla de la cuadricula: fija en su lugar, solo cambia su contenido. */
function Casilla({ casilla, resaltada }: { casilla: CasillaPantalla; resaltada: boolean }) {
  const ocupada = Boolean(casilla.codigo)

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border-4 transition-colors duration-500 ${
        ocupada
          ? resaltada
            ? 'border-emerald-400 bg-white motion-safe:animate-[pulse_1s_ease-in-out_2]'
            : 'border-brand-200 bg-white'
          : 'border-slate-200 bg-slate-50'
      }`}
    >
      <div
        className={`shrink-0 truncate px-4 py-2 text-center text-[clamp(0.85rem,1.6vw,1.15rem)] font-black uppercase tracking-wide ${
          ocupada ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-500'
        }`}
      >
        {casilla.moduloNombre}
        {casilla.profesionalNombre ? ` · ${casilla.profesionalNombre}` : ''}
      </div>

      {ocupada ? (
        <>
          <div className="grid min-h-0 flex-1 place-items-center bg-brand-50 px-3 py-4">
            <span className="truncate text-[clamp(2.25rem,7vw,5.5rem)] font-black leading-none tracking-[-0.03em] text-brand-800">
              {casilla.codigo}
            </span>
          </div>
          <div className="shrink-0 bg-brand-800 px-3 py-2 text-center text-white">
            <p className="truncate text-[clamp(1rem,2.1vw,1.4rem)] font-black leading-tight">
              {casilla.pacienteVisible ?? casilla.servicioNombre}
            </p>
            {casilla.pacienteVisible ? (
              <p className="truncate text-xs font-bold uppercase tracking-wide text-brand-200">
                {casilla.servicioNombre}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-3 py-6">
          <span className="text-[clamp(1rem,2vw,1.35rem)] font-black uppercase tracking-wide text-slate-400">
            Libre
          </span>
        </div>
      )}
    </div>
  )
}

export default function PantallaPublicaPage() {
  const [activo, setActivo] = useState(false)
  const [conectado, setConectado] = useState(false)
  const [sonidoActivo, setSonidoActivo] = useState(true)
  const [voz, setVoz] = useState<SpeechSynthesisVoice | null>(null)

  const [configuracion, setConfiguracion] = useState<ConfiguracionPantalla>(CONFIGURACION_POR_DEFECTO)
  // Una entrada por modulo activo, en el mismo orden que entrega el servidor.
  // Nunca se reordena ni se quita por tiempo: solo cambia el contenido de la
  // casilla cuyo modulo llamo o se libero.
  const [casillas, setCasillas] = useState<CasillaPantalla[]>([])
  const [resaltados, setResaltados] = useState<Set<string>>(new Set())

  // Inicializacion perezosa: una sola cola por montaje, sin recrearla en cada render.
  const [cola] = useState(() => new ColaDeAnuncios(locutorNavegador))
  const sonidoRef = useRef(sonidoActivo)
  const vozRef = useRef(voz)
  const configuracionRef = useRef(configuracion)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    sonidoRef.current = sonidoActivo
  }, [sonidoActivo])
  useEffect(() => {
    vozRef.current = voz
  }, [voz])
  useEffect(() => {
    configuracionRef.current = configuracion
  }, [configuracion])

  useEffect(() => alCargarVoces((voces) => setVoz(elegirVoz(voces))), [])

  const cargarEstado = useCallback(() => {
    fetch('/api/turnos/pantalla')
      .then((r) => r.json())
      .then((data) => {
        setCasillas(data.casillas ?? [])
        if (data.configuracion) setConfiguracion(data.configuracion)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    cargarEstado()
  }, [cargarEstado])

  /** Prende el resalte de un modulo y programa que se apague solo. */
  const resaltar = useCallback((moduloId: string) => {
    setResaltados((previos) => new Set(previos).add(moduloId))

    const timerPrevio = timersRef.current.get(moduloId)
    if (timerPrevio) clearTimeout(timerPrevio)

    const timer = setTimeout(() => {
      setResaltados((previos) => {
        const copia = new Set(previos)
        copia.delete(moduloId)
        return copia
      })
      timersRef.current.delete(moduloId)
    }, MS_RESALTE)
    timersRef.current.set(moduloId, timer)
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

  const manejarEvento = useCallback((evento: EventoTurno) => {
    if (evento.tipo === 'turno.llamado') {
      const { casilla } = evento

      // Solo se reemplaza la casilla de ESE modulo; las demas quedan intactas.
      setCasillas((previas) =>
        previas.map((c) => (c.moduloId === casilla.moduloId ? casilla : c)),
      )
      resaltar(casilla.moduloId)

      if (sonidoRef.current && configuracionRef.current.audioActivo) {
        // La campana suena SIEMPRE que el audio este activo, tenga o no voz.
        sonarCampana(configuracionRef.current.volumen)

        // Voz: solo español (se prefiere Colombia). Nunca se lee con voz inglesa;
        // si el equipo no tiene voz en español, queda solo la campana y el aviso.
        cola.encolar(textoAnuncio(casilla), {
          voz: vozRef.current,
          repeticiones: configuracionRef.current.repeticionesAudio,
          volumen: configuracionRef.current.volumen,
        })
      }
      return
    }

    if (evento.tipo === 'modulo.liberado') {
      const { moduloId } = evento
      setCasillas((previas) =>
        previas.map((c) => (c.moduloId === moduloId ? casillaLibreDesde(c) : c)),
      )
    }
  }, [cola, resaltar])

  useEffect(() => {
    if (!activo) return

    const es = new EventSource('/api/turnos/stream')
    es.onopen = () => {
      setConectado(true)
      // Al reconectar puede haberse perdido algun evento: resincronizamos.
      cargarEstado()
    }
    es.onerror = () => setConectado(false)
    es.onmessage = (event) => {
      try {
        manejarEvento(JSON.parse(event.data) as EventoTurno)
      } catch {
        // Ignorar mensajes que no sean JSON (p.ej. comentarios de keep-alive).
      }
    }

    return () => es.close()
  }, [activo, manejarEvento, cargarEstado])

  function activarPantalla() {
    setActivo(true)
    // Gesto del usuario: desbloquea el autoplay de audio en el navegador.
    sonarCampana(1)
  }

  /** Deja oir como sonara un llamado, antes de dejar la pantalla en el televisor. */
  function probarSonido() {
    sonarCampana(configuracion.volumen)
    cola.encolar('Turno de prueba. Por favor dirigirse a Consultorio uno.', {
      voz,
      repeticiones: 1,
      volumen: configuracion.volumen,
    })
  }

  if (!activo) {
    const vozColombiana = esVozColombiana(voz)

    return (
      <main className="grid min-h-screen place-items-center bg-[var(--turnos-sidebar)] px-6 text-center text-white">
        <div className="max-w-xl space-y-6">
          <Isotipo size={96} className="mx-auto" />
          <h1 className="text-3xl font-black tracking-[-0.02em]">Pantalla de turnos</h1>
          <p className="text-brand-100">
            {NOMBRE_INSTITUCION}. Pulsa el boton para activar la pantalla y el sonido de los llamados.
          </p>
          <button
            onClick={activarPantalla}
            className="mx-auto flex h-16 items-center justify-center rounded-2xl bg-emerald-500 px-10 text-xl font-black text-white transition hover:bg-emerald-400 active:scale-[.98]"
          >
            Activar pantalla
          </button>

          <button
            onClick={probarSonido}
            className="mx-auto block text-sm font-bold text-brand-200 underline underline-offset-4 transition hover:text-white"
          >
            Probar sonido
          </button>

          {voz ? (
            <p className={`text-sm ${vozColombiana ? 'text-brand-200/80' : 'text-amber-300'}`}>
              {vozColombiana ? 'Voz del llamado: ' : 'Voz del llamado (no es colombiana): '}
              {voz.name}
            </p>
          ) : (
            <div className="mx-auto flex max-w-md items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-left text-sm text-amber-200">
              <WarningCircle size={22} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                Este equipo no tiene voz en español, asi que el llamado sonara solo con la campana (nunca
                con voz inglesa). Para que hable en español de Colombia: abre esta pantalla en Microsoft
                Edge, o instala la voz ejecutando el archivo{' '}
                <span className="font-mono font-bold">scripts/instalar-voz-colombia.ps1</span>.
              </span>
            </div>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex shrink-0 items-center justify-between gap-6 bg-white px-8 py-4">
        <div className="flex items-center gap-4">
          <Isotipo size={56} />
          <div className="leading-tight">
            <p className="text-xl font-black tracking-[-0.02em] text-brand-800">{NOMBRE_SISTEMA}</p>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-slate-500">
              {NOMBRE_INSTITUCION}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black ${
              conectado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${conectado ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {conectado ? 'EN VIVO' : 'RECONECTANDO'}
          </span>
          <Reloj />
          <button
            onClick={() => setSonidoActivo((v) => !v)}
            className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-600 transition hover:bg-slate-200"
            aria-label={sonidoActivo ? 'Desactivar sonido' : 'Activar sonido'}
          >
            {sonidoActivo ? <SpeakerHigh size={22} weight="bold" /> : <SpeakerX size={22} weight="bold" />}
          </button>
        </div>
      </header>

      {/*
        Cuadricula fija: una casilla por modulo activo, todas visibles a la
        vez. `auto-fit` reparte el espacio disponible solo con 1, con 4 o con
        10+ casillas, sin que el operador tenga que ajustar nada.
      */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {casillas.length === 0 ? (
          <div className="grid h-full place-items-center">
            <p className="text-2xl font-bold text-slate-400">Aun no hay consultorios ni ventanillas activos.</p>
          </div>
        ) : (
          <div
            className="grid h-full auto-rows-fr gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}
          >
            {casillas.map((casilla) => (
              <Casilla key={casilla.moduloId} casilla={casilla} resaltada={resaltados.has(casilla.moduloId)} />
            ))}
          </div>
        )}
      </div>

      {configuracion.mensajePie ? (
        <footer className="shrink-0 overflow-hidden whitespace-nowrap bg-brand-800 px-8 py-2.5 text-center text-lg font-bold text-white">
          {configuracion.mensajePie}
        </footer>
      ) : null}
    </main>
  )
}

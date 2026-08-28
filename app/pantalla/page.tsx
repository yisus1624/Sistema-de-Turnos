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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, CornersIn, CornersOut, SpeakerHigh, SpeakerX, WarningCircle } from '@phosphor-icons/react/dist/ssr'
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

  // Numero suelto del consultorio ("Consultorio 5" -> "5"), para el bloque
  // secundario de la tarjeta: de un vistazo, sin tener que leer el nombre.
  const numeroModulo = casilla.moduloNombre.match(/\d+\s*$/)?.[0]?.trim()

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_2px_10px_rgba(10,38,52,.08)] ring-1 transition-all duration-500 ${
        ocupada
          ? resaltada
            ? 'ring-2 ring-emerald-400 motion-safe:animate-[pulse_1s_ease-in-out_2]'
            : 'ring-slate-200'
          : 'ring-slate-200'
      }`}
    >
      <div
        className={`shrink-0 truncate px-3 py-1.5 text-center text-[clamp(0.65rem,calc(1.6vmin*var(--escala)),1rem)] font-black uppercase tracking-wide ${
          ocupada ? 'bg-slate-100 text-brand-900' : 'bg-slate-100 text-slate-400'
        }`}
      >
        {/* El numero del consultorio ya se ve grande abajo; aqui basta con
            quien atiende (o el nombre del modulo si es una ventanilla). */}
        {casilla.profesionalNombre ?? casilla.moduloNombre}
      </div>

      {ocupada ? (
        <>
          {/* Franja partida en dos tonos, al estilo de un letrero digital: el
              turno en el bloque oscuro (lo que se anuncia), el numero del
              consultorio en el bloque claro (a donde dirigirse). */}
          <div className="grid grid-cols-[1.7fr_1fr]">
            <div className="grid place-items-center bg-brand-950 px-2 py-[clamp(0.4rem,calc(1.6vmin*var(--escala)),1rem)]">
              <span className="text-[clamp(1.4rem,calc(7vmin*var(--escala)),3.5rem)] font-black leading-none tracking-[-0.03em] text-white">
                {casilla.codigo}
              </span>
            </div>
            <div className="grid place-items-center bg-brand-600 px-2 py-[clamp(0.4rem,calc(1.6vmin*var(--escala)),1rem)]">
              <span className="text-[clamp(1.2rem,calc(6vmin*var(--escala)),3rem)] font-black leading-none text-white">
                {numeroModulo ?? '—'}
              </span>
            </div>
          </div>
          {/* El servicio ya se anuncia en el titulo de la columna, asi que
              aqui solo va el paciente: menos ruido, letra mas grande. */}
          <div className="shrink-0 bg-brand-900 px-3 py-2 text-center text-white">
            <p className="text-balance text-[clamp(0.85rem,calc(2.4vmin*var(--escala)),1.5rem)] font-black leading-tight">
              {casilla.pacienteVisible ?? casilla.servicioNombre}
            </p>
          </div>
        </>
      ) : (
        <div className="grid place-items-center bg-slate-50 px-3 py-[clamp(0.9rem,calc(3.5vmin*var(--escala)),2rem)]">
          <span className="text-[clamp(0.75rem,calc(2vmin*var(--escala)),1.15rem)] font-black uppercase tracking-wide text-slate-400">
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
  const [pantallaCompleta, setPantallaCompleta] = useState(false)

  const [configuracion, setConfiguracion] = useState<ConfiguracionPantalla>(CONFIGURACION_POR_DEFECTO)
  // Una entrada por modulo activo, en el mismo orden que entrega el servidor.
  // Nunca se reordena ni se quita por tiempo: solo cambia el contenido de la
  // casilla cuyo modulo llamo o se libero.
  const [casillas, setCasillas] = useState<CasillaPantalla[]>([])
  // Un solo modulo resaltado a la vez: el foco sigue al llamado mas reciente,
  // no se queda pegado en el anterior mientras ya se esta llamando a otro.
  const [resaltado, setResaltado] = useState<string | null>(null)

  // Inicializacion perezosa: una sola cola por montaje, sin recrearla en cada render.
  const [cola] = useState(() => new ColaDeAnuncios(locutorNavegador))
  const sonidoRef = useRef(sonidoActivo)
  const vozRef = useRef(voz)
  const configuracionRef = useRef(configuracion)
  const timerResalteRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  /**
   * Prende el resalte de un modulo y programa que se apague solo. Quitar el
   * timer previo (de OTRO modulo) apaga su resalte de inmediato: el foco
   * salta al ultimo llamado en vez de quedarse encendido en dos casillas a
   * la vez mientras el anterior espera a que se cumplan sus 8 segundos.
   */
  const resaltar = useCallback((moduloId: string) => {
    if (timerResalteRef.current) clearTimeout(timerResalteRef.current)

    setResaltado(moduloId)
    timerResalteRef.current = setTimeout(() => {
      setResaltado((actual) => (actual === moduloId ? null : actual))
      timerResalteRef.current = null
    }, MS_RESALTE)
  }, [])

  useEffect(() => {
    return () => {
      if (timerResalteRef.current) clearTimeout(timerResalteRef.current)
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

  /**
   * Pantalla completa real (sin barra de direcciones ni pestañas), que es
   * como debe quedar en el televisor de la sala de espera. El navegador solo
   * la concede dentro de un gesto del usuario, por eso se pide desde un
   * clic y nunca automaticamente al cargar.
   */
  const alternarPantallaCompleta = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void document.documentElement.requestFullscreen().catch(() => {})
    }
  }, [])

  // El usuario tambien puede salir con Escape o F11: hay que seguir el estado
  // real del navegador, no solo el de nuestro boton.
  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', alCambiar)
    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [])

  function activarPantalla() {
    setActivo(true)
    // Gesto del usuario: desbloquea el autoplay de audio en el navegador y,
    // de paso, deja la pantalla a todo el televisor sin barras del navegador.
    sonarCampana(1)
    void document.documentElement.requestFullscreen().catch(() => {})
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

  // Agrupadas por servicio (Consulta externa, Odontologia...) para que el
  // paciente busque directo en la fila de su especialidad, en vez de tener
  // que barrer toda la cuadricula. Las ventanillas (sin servicio fijo) van
  // en su propio grupo. El orden es el de llegada de cada servicio, el mismo
  // en que el servidor entrega los modulos.
  const grupos = useMemo(() => {
    const mapa = new Map<string, { clave: string; nombre: string; casillas: CasillaPantalla[] }>()
    for (const casilla of casillas) {
      const clave = casilla.servicioId || 'ventanilla'
      const grupo = mapa.get(clave)
      if (grupo) grupo.casillas.push(casilla)
      else mapa.set(clave, { clave, nombre: casilla.servicioNombre, casillas: [casilla] })
    }
    return Array.from(mapa.values())
  }, [casillas])

  if (!activo) {
    const vozColombiana = esVozColombiana(voz)

    return (
      <main className="grid min-h-screen place-items-center bg-[var(--turnos-sidebar)] px-6 text-center text-white">
        <div className="max-w-xl space-y-6">
          <Isotipo size={96} className="mx-auto" />
          <h1 className="text-3xl font-black tracking-[-0.02em]">Pantalla de turnos</h1>
          <p className="text-brand-100">
            {NOMBRE_INSTITUCION}. Pulsa el boton para activar la pantalla completa y el sonido de los
            llamados.
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
      <header className="flex shrink-0 items-center justify-between gap-6 border-b border-slate-200 bg-white px-8 py-4 shadow-[0_1px_0_rgba(10,38,52,.04)]">
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
          <button
            onClick={alternarPantallaCompleta}
            className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-600 transition hover:bg-slate-200"
            aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
            title={pantallaCompleta ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
          >
            {pantallaCompleta ? <CornersIn size={22} weight="bold" /> : <CornersOut size={22} weight="bold" />}
          </button>
        </div>
      </header>

      {/*
        Una COLUMNA por servicio (Consulta externa, Odontologia...), para que
        el paciente busque directo en la columna de su especialidad. TODOS
        los consultorios activos se muestran siempre, sin esconder ninguno:
        `--escala` (calculada de la columna mas llena) encoge la letra de
        cada tarjeta a medida que hay mas, para que sigan cabiendo todas
        legibles en vez de desbordar la pantalla.
        Si hay tantos servicios que las columnas no caben en el ancho de la
        pantalla, se pueden desplazar de lado (nunca se recorta ni desaparece
        nada): a proposito esta pantalla no rota nada por tiempo (ver
        comentario del archivo), asi que el desplazamiento manual es la
        salida segura.
      */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {casillas.length === 0 ? (
          <div className="grid h-full place-items-center">
            <p className="text-2xl font-bold text-slate-400">Aun no hay consultorios ni ventanillas activos.</p>
          </div>
        ) : (
          <div
            className="grid min-h-full items-start gap-4"
            style={
              {
                gridTemplateColumns: `repeat(${grupos.length}, minmax(220px, 1fr))`,
                '--escala': Math.max(0.45, Math.min(1, 4 / Math.max(1, ...grupos.map((g) => g.casillas.length)))),
              } as React.CSSProperties
            }
          >
            {grupos.map((grupo) => (
              <section key={grupo.clave} className="flex flex-col gap-2">
                {/* El nombre del servicio es lo PRIMERO que busca el paciente
                    ("¿donde esta pediatria?"), asi que va centrado y grande. */}
                <h2 className="shrink-0 rounded-lg bg-brand-100 px-3 py-1.5 text-center text-[clamp(1rem,2.2vmin,1.6rem)] font-black uppercase leading-tight tracking-[0.04em] text-brand-900">
                  {grupo.nombre}
                </h2>
                {/* Rotulos de las dos mitades de cada tarjeta, para que se
                    entienda que numero es el turno y cual el consultorio. */}
                <div className="grid shrink-0 grid-cols-[1.7fr_1fr] overflow-hidden rounded-lg text-center text-[clamp(0.8rem,1.7vmin,1.25rem)] font-black uppercase tracking-wide text-white">
                  <span className="truncate bg-brand-950 px-2 py-1.5">Turno</span>
                  <span className="truncate bg-brand-600 px-2 py-1.5">Consultorio</span>
                </div>
                <div className="flex flex-col gap-2">
                  {grupo.casillas.map((casilla) => (
                    <Casilla key={casilla.moduloId} casilla={casilla} resaltada={resaltado === casilla.moduloId} />
                  ))}
                </div>
              </section>
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

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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, CornersIn, CornersOut, SpeakerHigh, SpeakerX } from '@phosphor-icons/react/dist/ssr'
import type { EventoTurno } from '@/lib/realtime/hub'
import type { CasillaPantalla, ConfiguracionSistema } from '@/lib/turnos/types'
import { CampanaDeLlamado, sonarCampana } from '@/lib/turnos/anuncio'
import { Isotipo, NOMBRE_INSTITUCION, NOMBRE_SISTEMA } from '@/components/brand/Marca'

/** Cuanto dura el resalte visual de la casilla recien llamada, en milisegundos. */
const MS_RESALTE = 8000

/**
 * Cada cuanto se vuelve a pedir el estado completo (casillas y configuracion).
 *
 * Un minuto: lo bastante seguido para que un consultorio nuevo o un cambio de
 * configuracion entren solos, y lo bastante espaciado para no hacerle nada al
 * servidor. Los llamados siguen llegando al instante por SSE; esto solo repone
 * lo que los eventos no traen.
 */
const MS_RESINCRONIZAR = 60000

const CONFIGURACION_POR_DEFECTO: ConfiguracionSistema = {
  audioActivo: true,
  volumen: 1,
  ultimosVisibles: 5,
  mensajePie: '',
  // La pantalla no usa los parametros de agenda, pero el tipo es el de la
  // configuracion completa: se dejan los mismos valores iniciales del servidor.
  duracionCitaMinutos: 15,
  jornadaMananaInicio: '07:00',
  jornadaMananaFin: '12:00',
  jornadaTardeInicio: '13:00',
  jornadaTardeFin: '17:00',
}

/** Ancho minimo comodo de una tarjeta, en pixeles, para que se lea de lejos. */
const ANCHO_MINIMO_TARJETA = 240

/**
 * Reparte N tarjetas en una cuadricula lo mas cuadrada posible.
 *
 * Se calculan las columnas en vez de dejarselo a `auto-fill` porque el
 * navegador llena la primera fila hasta el tope y deja la ultima coja: ocho
 * consultorios en una pantalla que admite seis columnas quedan 6 + 2, con
 * cuatro huecos enormes. Repartidos a cuatro por fila quedan 4 + 4 y no sobra
 * espacio, que es lo que se ve bien en un televisor.
 */
function distribucionEquilibrada(total: number, maxColumnas: number) {
  if (total <= 0) return { filas: 1, columnas: 1 }

  const filas = Math.max(1, Math.ceil(total / maxColumnas))
  return { filas, columnas: Math.ceil(total / filas) }
}

/** Una casilla "libre" (sin turno) para reponer un modulo cuando se libera. */
function casillaLibreDesde(casilla: CasillaPantalla): CasillaPantalla {
  return {
    ...casilla,
    turnoId: null,
    codigo: null,
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

/**
 * Una casilla de la cuadricula: un consultorio o ventanilla, fijo en su lugar.
 *
 * La tarjeta responde a las dos unicas preguntas del paciente: QUE TURNO va
 * (el codigo, enorme, que es ademas lo que suena) y A DONDE ENTRA (el nombre
 * del consultorio, que es lo que esta escrito en la puerta). El doctor va al
 * pie, como referencia; nada del paciente aparece aqui.
 *
 * Memorizada: cada llamado cambia UNA casilla, pero sin esto se volvian a
 * dibujar las veinte. En un televisor barato, con animaciones de por medio y la
 * pagina abierta dias enteros, ese trabajo de mas se nota.
 */
const Casilla = memo(function Casilla({ casilla, resaltada }: { casilla: CasillaPantalla; resaltada: boolean }) {
  const ocupada = Boolean(casilla.codigo)

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_2px_10px_rgba(10,38,52,.08)] ring-1 transition-all duration-500 ${
        ocupada && resaltada
          ? 'ring-2 ring-emerald-400 motion-safe:animate-[pulse_1s_ease-in-out_2]'
          : 'ring-slate-200'
      }`}
    >
      {/*
        El nombre del consultorio es lo que orienta al paciente: en el hospital
        la especialidad esta en el rotulo de la puerta ("CONS 03 - P y M"), asi
        que se muestra completo y no un numero suelto. Se deja envolver en dos
        lineas antes que recortarlo.
      */}
      <div
        className={`shrink-0 px-3 py-2.5 text-center text-[clamp(0.85rem,calc(2.7vmin*var(--escala)),2.1rem)] font-black uppercase leading-tight tracking-wide ${
          ocupada ? 'bg-brand-100 text-brand-900' : 'bg-slate-100 text-slate-400'
        }`}
      >
        <span className="line-clamp-2 text-balance">{casilla.moduloNombre}</span>
      </div>

      {ocupada ? (
        <>
          <div className="grid min-h-0 flex-1 place-items-center bg-brand-950 px-2 py-[clamp(0.5rem,calc(2vmin*var(--escala)),1.4rem)]">
            <span className="text-[clamp(1.6rem,calc(9vmin*var(--escala)),6rem)] font-black leading-none tracking-[-0.03em] text-white">
              {casilla.codigo}
            </span>
          </div>
          {casilla.profesionalNombre ? (
            <div className="shrink-0 bg-brand-900 px-3 py-2 text-center text-white">
              <p className="truncate text-[clamp(0.8rem,calc(2.7vmin*var(--escala)),2rem)] font-black leading-tight">
                {casilla.profesionalNombre}
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center bg-slate-50 px-3 py-[clamp(1rem,calc(4vmin*var(--escala)),2.4rem)]">
          <span className="text-[clamp(0.85rem,calc(2.8vmin*var(--escala)),2rem)] font-black uppercase tracking-wide text-slate-400">
            Libre
          </span>
        </div>
      )}
    </div>
  )
})

export default function PantallaPublicaPage() {
  const [activo, setActivo] = useState(false)
  const [conectado, setConectado] = useState(false)
  const [sonidoActivo, setSonidoActivo] = useState(true)
  const [pantallaCompleta, setPantallaCompleta] = useState(false)
  // Ancho real de la pantalla donde esta puesta, para repartir las tarjetas.
  // Arranca en un valor de televisor y se corrige al montar: en el servidor no
  // hay ventana que medir.
  const [anchoVentana, setAnchoVentana] = useState(1920)

  const [configuracion, setConfiguracion] = useState<ConfiguracionSistema>(CONFIGURACION_POR_DEFECTO)
  // Una entrada por modulo activo, en el mismo orden que entrega el servidor.
  // Nunca se reordena ni se quita por tiempo: solo cambia el contenido de la
  // casilla cuyo modulo llamo o se libero.
  const [casillas, setCasillas] = useState<CasillaPantalla[]>([])
  // Un solo modulo resaltado a la vez: el foco sigue al llamado mas reciente,
  // no se queda pegado en el anterior mientras ya se esta llamando a otro.
  const [resaltado, setResaltado] = useState<string | null>(null)

  // Inicializacion perezosa: una sola campana por montaje, sin recrearla en
  // cada render. Ella misma reparte la rafaga: si varios consultorios llaman
  // casi al tiempo, suena una campanada por cada uno, separadas un segundo para
  // que no se pisen (ver `MS_SEPARACION`).
  const [campana] = useState(() => new CampanaDeLlamado(sonarCampana))
  const sonidoRef = useRef(sonidoActivo)
  const configuracionRef = useRef(configuracion)
  const timerResalteRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cuantos eventos en vivo se han aplicado. Sirve para saber si una
  // resincronizacion que ya venia de camino quedo obsoleta (ver `cargarEstado`).
  const eventosAplicadosRef = useRef(0)
  // Que modulos tiene pintados la pantalla ahora mismo. Sirve para detectar un
  // llamado de un consultorio que todavia no esta en la cuadricula (ver
  // `manejarEvento`); se lee desde el manejador de eventos, que no puede
  // depender del estado sin volver a suscribirse al SSE en cada llamado.
  const modulosRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    sonidoRef.current = sonidoActivo
    // Al silenciar hay que vaciar la cola: si no, las campanadas que ya estaban
    // esperando su segundo salen igual despues de pulsar el boton de mudo.
    if (!sonidoActivo) campana.reiniciar()
  }, [sonidoActivo, campana])

  // Al cerrar la pantalla no puede quedar ningun temporizador de campana vivo.
  useEffect(() => {
    return () => campana.reiniciar()
  }, [campana])
  useEffect(() => {
    configuracionRef.current = configuracion
  }, [configuracion])
  useEffect(() => {
    modulosRef.current = new Set(casillas.map((c) => c.moduloId))
  }, [casillas])

  /**
   * Resincronizacion completa, sin pisar lo que acaba de pasar.
   *
   * La respuesta de esta consulta es una foto del momento en que el servidor la
   * respondio. Si mientras viajaba llega un llamado por SSE, aplicar la foto
   * despues BORRA ese llamado de la pantalla: el paciente al que acaban de
   * llamar desaparece del televisor y no vuelve hasta el siguiente evento de
   * ese mismo consultorio, que puede tardar toda la consulta. Por eso se cuenta
   * cuantos eventos se han aplicado: si cambio durante el viaje, las casillas
   * de la foto se descartan (las de los eventos son mas nuevas) y solo se toma
   * la configuracion, que ningun evento trae.
   */
  const cargarEstado = useCallback(() => {
    const eventosAlPedir = eventosAplicadosRef.current

    fetch('/api/turnos/pantalla')
      .then((r) => r.json())
      .then((data) => {
        if (data.configuracion) setConfiguracion(data.configuracion)
        if (eventosAplicadosRef.current !== eventosAlPedir) return

        setCasillas(data.casillas ?? [])
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
    // Se cuenta ANTES de aplicar nada: cualquier resincronizacion que este de
    // camino trae una foto anterior a este evento y no debe pisarlo.
    eventosAplicadosRef.current += 1

    if (evento.tipo === 'turno.llamado') {
      const { casilla } = evento

      // Un llamado de un modulo que no esta en la cuadricula.
      //
      // La cuadricula se arma con los modulos ACTIVOS del momento en que se
      // pidio el estado. Si el administrador activa un consultorio despues, su
      // casilla no existe aqui todavia: el `map` de abajo no encuentra a quien
      // reemplazar, asi que sonaba la campana y en la pantalla no aparecia
      // nada. El paciente oye que pasa un turno, mira, y no ve su numero por
      // ningun lado hasta la siguiente resincronizacion, que puede tardar un
      // minuto. Pedir el estado completo trae la casilla nueva de inmediato.
      if (!modulosRef.current.has(casilla.moduloId)) cargarEstado()

      // Solo se reemplaza la casilla de ESE modulo; las demas quedan intactas.
      setCasillas((previas) =>
        previas.map((c) => (c.moduloId === casilla.moduloId ? casilla : c)),
      )
      resaltar(casilla.moduloId)

      // UNA campanita POR LLAMADO, no una por tanda.
      //
      // Si dos o tres consultorios pasan paciente casi al tiempo, sus eventos
      // llegan aqui con milisegundos de diferencia. La campana se encarga de
      // separarlos un segundo entre si (ver `MS_SEPARACION`): asi la sala
      // cuenta de oido cuantos turnos pasaron, en vez de oir las tres campanadas
      // solapadas como un solo sonido. Que turno es y a que consultorio va lo
      // sigue diciendo la pantalla.
      if (sonidoRef.current && configuracionRef.current.audioActivo) {
        campana.anunciar(configuracionRef.current.volumen)
      }
      return
    }

    if (evento.tipo === 'modulo.liberado') {
      const { moduloId } = evento
      setCasillas((previas) =>
        previas.map((c) => (c.moduloId === moduloId ? casillaLibreDesde(c) : c)),
      )
    }
  }, [campana, resaltar, cargarEstado])

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
   * Resincronizacion periodica.
   *
   * Los eventos en vivo solo traen la casilla que cambio, asi que sin esto la
   * pantalla se quedaba clavada con el estado del momento en que se encendio:
   * un consultorio nuevo no aparecia nunca, el mensaje al pie y el volumen que
   * el administrador acababa de guardar no llegaban, y pasada la medianoche
   * seguian pintadas las casillas del dia anterior. Este televisor lleva dias
   * encendido sin que nadie lo recargue, que es justo el caso que hay que
   * cuidar.
   */
  useEffect(() => {
    if (!activo) return

    const id = setInterval(cargarEstado, MS_RESINCRONIZAR)
    return () => clearInterval(id)
  }, [activo, cargarEstado])

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

  // El reparto de las tarjetas depende del ancho: hay que recalcularlo cuando
  // la pantalla entra o sale de pantalla completa, o si se conecta a un
  // televisor de otra resolucion.
  useEffect(() => {
    const medir = () => setAnchoVentana(window.innerWidth)
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
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

  // Cuantas mas casillas haya, mas angostas y con menos letra, para que
  // quepan todas sin desbordar la pantalla del televisor. Los limites estan
  // puestos para que cuatro consultorios se vean grandes y veinte sigan
  // siendo legibles de lejos.
  // Cuantas tarjetas caben de ancho, segun el televisor donde este puesta.
  //
  // Con tope de seis aunque quepan mas: pasadas seis columnas, las tarjetas se
  // vuelven tiras finas y bajas que se leen peor de lejos, y ademas la ultima
  // fila de un bloque pequeño deja muchas celdas libres. Con menos columnas y
  // mas filas, las tarjetas salen mas grandes y sobra menos sitio.
  const maxColumnas = Math.min(6, Math.max(1, Math.floor(anchoVentana / ANCHO_MINIMO_TARJETA)))

  // UNA sola cantidad de columnas para todos los bloques, calculada a partir
  // del bloque mas grande. Si cada bloque eligiera las suyas, un bloque de dos
  // consultorios repartiria el ancho entre dos y sus tarjetas saldrian del
  // doble de grandes que las de al lado; con la misma reja para todos, todas
  // las tarjetas miden igual y solo quedan libres las celdas del final.
  const columnas = distribucionEquilibrada(
    Math.max(1, ...grupos.map((g) => g.casillas.length)),
    maxColumnas,
  ).columnas

  // Cuantas filas ocupa cada bloque con esa reja, para darle a cada uno el
  // alto que le corresponde.
  const filasPorGrupo = grupos.map((grupo) => Math.max(1, Math.ceil(grupo.casillas.length / columnas)))
  const filasTotales = filasPorGrupo.reduce((suma, filas) => suma + filas, 0) || 1

  // La letra encoge segun cuantas FILAS hay que apilar, no segun cuantas
  // tarjetas: con las tarjetas estirandose para llenar el alto, lo que aprieta
  // es el numero de filas.
  const escala = Math.max(0.55, Math.min(1, 2.5 / filasTotales))

  if (!activo) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--turnos-sidebar)] px-6 text-center text-white">
        <div className="max-w-xl space-y-6">
          <Isotipo size={96} className="mx-auto" />
          <h1 className="text-3xl font-black tracking-[-0.02em]">Pantalla de turnos</h1>
          <p className="text-brand-100">
            {NOMBRE_INSTITUCION}. Pulsa el boton para activar la pantalla completa y el sonido de los
            llamados. En cada turno que pase suena una campanita; el turno y el consultorio se leen en la
            pantalla.
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
        UNA SECCION POR SERVICIO, y dentro las tarjetas de sus consultorios
        fluyendo en cuadricula.

        Antes cada servicio era una COLUMNA, con sus consultorios apilados. Eso
        se cae con la forma real del hospital: casi todo cuelga de consulta
        externa, asi que quedaba una sola columna angosta con diez consultorios
        en fila india y media pantalla vacia. Con `auto-fit` las tarjetas
        reparten el ancho disponible: diez consultorios de un mismo servicio se
        ven en dos o tres filas, y si mañana crean otro servicio aparece como
        una seccion mas, sin tocar codigo.

        TODOS los consultorios activos se muestran siempre, sin esconder
        ninguno ni rotar por tiempo (ver el comentario de cabecera): `--escala`
        encoge la letra a medida que hay mas, para que sigan cabiendo legibles
        en vez de desbordar.
      */}
      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {casillas.length === 0 ? (
          <div className="grid h-full place-items-center">
            <p className="text-2xl font-bold text-slate-400">Aun no hay consultorios ni ventanillas activos.</p>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-4" style={{ '--escala': escala } as React.CSSProperties}>
            {grupos.map((grupo, indice) => {
              const filas = filasPorGrupo[indice]

              return (
                <section
                  key={grupo.clave}
                  className="flex min-h-0 flex-col gap-2"
                  // Cada bloque se queda con el alto proporcional a las filas
                  // que ocupa, para que entre todos llenen la pantalla: un
                  // bloque de ocho consultorios recibe el doble de alto que uno
                  // de dos, en vez de que todos queden pegados arriba y sobre
                  // media pantalla vacia.
                  style={{ flex: `${filas} 1 0%` }}
                >
                  {/* El nombre del servicio encabeza su bloque; lo que de verdad
                      guia al paciente es el consultorio de cada tarjeta. */}
                  <h2 className="shrink-0 rounded-lg bg-brand-100 px-4 py-2 text-[clamp(1.15rem,3vmin,2.6rem)] font-black uppercase leading-tight tracking-[0.04em] text-brand-900">
                    {grupo.nombre}
                  </h2>
                  <div
                    className="grid min-h-0 flex-1 gap-3"
                    style={{
                      // Numero de columnas FIJO y calculado (ver
                      // `distribucionEquilibrada`), no `auto-fill`: con ocho
                      // consultorios y seis columnas, `auto-fill` deja una fila
                      // de seis y otra de dos, con cuatro huecos. Repartidos en
                      // cuatro por fila se llena todo.
                      gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))`,
                      // Filas del mismo alto: las tarjetas se estiran para
                      // ocupar lo que les toca en vez de quedarse pequeñas.
                      gridAutoRows: 'minmax(0, 1fr)',
                    }}
                  >
                    {grupo.casillas.map((casilla) => (
                      <Casilla key={casilla.moduloId} casilla={casilla} resaltada={resaltado === casilla.moduloId} />
                    ))}
                  </div>
                </section>
              )
            })}
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

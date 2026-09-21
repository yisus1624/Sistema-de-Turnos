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
import { Clock } from '@phosphor-icons/react/dist/ssr'
import type { EventoTurno } from '@/lib/realtime/hub'
import { crearCanalEnVivo, type EstadoConexionEnVivo } from '@/lib/hooks'
import { CONFIGURACION_INICIAL } from '@/lib/turnos/configuracion-inicial'
import type { CasillaPantalla, ConfiguracionSistema } from '@/lib/turnos/types'
import { CampanaDeLlamado, sonarCampana } from '@/lib/turnos/anuncio'
import { Isotipo, NOMBRE_INSTITUCION, NOMBRE_SISTEMA } from '@/components/brand/Marca'
import Cartelera from './Cartelera'
import ControlesPantalla from './ControlesPantalla'
import FondoPantalla from './FondoPantalla'

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

/**
 * Con que arranca la pantalla hasta que el servidor conteste.
 *
 * Los mismos valores del servidor, no una copia a mano: el volumen de la
 * campanita llego a valer una cosa aqui y otra en la base, asi que la primera
 * campanada del televisor sonaba a un volumen distinto del que el
 * administrador tenia configurado. Solo el mensaje al pie se deja vacio: es
 * texto institucional que no se puede inventar antes de leerlo.
 */
const CONFIGURACION_POR_DEFECTO: ConfiguracionSistema = { ...CONFIGURACION_INICIAL, mensajePie: '' }

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
    codigo: null,
    horaLlamado: null,
    vecesLlamado: 0,
  }
}

/**
 * La hora actual, refrescada cada quince segundos.
 *
 * Vive aparte del `Reloj` porque los DOS diseños de pantalla la necesitan —la
 * cuadricula la pinta abajo a la derecha y la cartelera arriba— y tener dos
 * temporizadores para el mismo dato significa que, con un televisor encendido
 * toda la jornada, los dos acaban marcando minutos distintos.
 *
 * Arranca en `null` a proposito: la hora del servidor y la del televisor no
 * tienen por que coincidir, y pintarla antes de que monte el componente haria
 * que React se quejara de que el HTML del servidor no cuadra con el del
 * navegador.
 */
function useAhora() {
  const [ahora, setAhora] = useState<Date | null>(null)

  useEffect(() => {
    setAhora(new Date())
    const id = setInterval(() => setAhora(new Date()), 15000)
    return () => clearInterval(id)
  }, [])

  return ahora
}

/** La hora en formato "HH:MM", en hora de Colombia. */
function horaColombiana(ahora: Date) {
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(ahora)
}

function Reloj() {
  const ahora = useAhora()

  if (!ahora) return null

  const hora = horaColombiana(ahora)
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
        <p className="text-2xl font-semibold tabular-nums tracking-[-0.01em] text-slate-700">{hora}</p>
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

  /*
   * LA CASILLA SE LEE COMO UNA FICHA FISICA COLGADA EN LA PARED.
   *
   * Tres cambios, todos pensados para verse A VARIOS METROS:
   *
   * - Esquinas mas redondas (24px). A la distancia de una sala de espera, una
   *   esquina apretada se percibe casi recta y la ficha parece un recuadro
   *   dibujado; una curva amplia se sigue leyendo como curva y da el aspecto
   *   de objeto.
   * - Sombra en dos capas en vez de una difusa. Levanta la ficha del fondo de
   *   verdad, en lugar de dejarle un halo gris alrededor.
   * - El aro del turno recien llamado pasa a 4px y verde esmeralda pleno: era
   *   de 2px, y a esa distancia, contra el blanco, practicamente no se
   *   distinguia del borde normal. Es LA senal de la pantalla —"te toca a
   *   ti"— y tiene que ganar sin ninguna duda.
   */
  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] bg-white transition-all duration-500 ${
        ocupada && resaltada
          ? 'shadow-[0_0_0_4px_rgb(52,211,153),0_12px_32px_rgba(10,38,52,.18)] motion-safe:animate-[pulse_1s_ease-in-out_2]'
          : 'shadow-[0_0_0_1px_rgba(10,38,52,.07),0_4px_14px_rgba(10,38,52,.07)]'
      }`}
    >
      {/*
        El nombre del consultorio es lo que orienta al paciente: en el hospital
        la especialidad esta en el rotulo de la puerta ("CONS 03 - P y M"), asi
        que se muestra completo y no un numero suelto. Se deja envolver en dos
        lineas antes que recortarlo.
      */}
      {/*
        El rotulo del consultorio respira mas (py-3) y afloja el espaciado de
        letras: en mayusculas, en negra maxima y con `tracking-wide`, a tamano
        grande las palabras se estiraban tanto que costaba leerlas de un golpe.
        Un espaciado corto y peso 800 —firme, pero no macizo— se lee antes
        desde lejos, que es todo lo que importa aqui.
      */}
      <div
        className={`shrink-0 px-3 py-3 text-center text-[clamp(0.85rem,calc(2.7vmin*var(--escala)),2.1rem)] font-extrabold uppercase leading-tight tracking-[0.02em] ${
          ocupada ? 'bg-brand-100 text-brand-900' : 'bg-slate-100/80 text-slate-400'
        }`}
      >
        <span className="line-clamp-2 text-balance">{casilla.moduloNombre}</span>
      </div>

      {ocupada ? (
        <>
          <div className="grid min-h-0 flex-1 place-items-center bg-brand-950 px-2 py-[clamp(0.5rem,calc(2vmin*var(--escala)),1.4rem)]">
            {/*
              EL TURNO ES EL DATO DE LA PANTALLA. Se aprieta mas (-0.045em) y
              lleva cifras de ancho fijo.

              Lo del ancho fijo no es un detalle: la casilla se refresca sola,
              y con cifras proporcionales el numero CAMBIA DE ANCHO al pasar
              de "A-11" a "A-08", asi que el turno daba un salto lateral a
              cada actualizacion. Desde la sala se ve como un parpadeo raro.
              Con ancho fijo se queda clavado en su sitio.
            */}
            <span
              data-cifras
              className="text-[clamp(1.6rem,calc(9vmin*var(--escala)),6rem)] font-black leading-none tracking-[-0.045em] text-white"
            >
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

/**
 * Donde recuerda cada televisor si lo dejaron en mudo.
 *
 * ES UNA DECISION DE ESA SALA, NO DEL HOSPITAL, y por eso va en el navegador
 * del televisor y no en la configuracion de la base. La de la base
 * (`audioActivo`, `volumen`) la toma el administrador una vez y vale para
 * todas las salas; esta es la de la enfermera que silencia LA SUYA porque al
 * lado hay consultorios, y silenciarlas todas desde aqui seria justo lo
 * contrario de lo que pidio.
 *
 * Las dos mandan: suena solo si el hospital tiene el audio encendido Y este
 * televisor no esta en mudo (ver el llamado, mas abajo).
 */
const CLAVE_SONIDO = 'turnos-pantalla-sonido'

/**
 * Lee el mudo guardado. Ante cualquier duda, CON SONIDO.
 *
 * El navegador puede tener el almacenamiento bloqueado o lleno, o estar en
 * modo privado. Si no se sabe que se quiso, se prefiere que la sala oiga el
 * llamado: un televisor mudo por accidente hace que un paciente pierda su
 * turno, y uno que suena de mas solo molesta hasta que alguien lo silencia.
 */
function leerSonidoGuardado(): boolean {
  try {
    return localStorage.getItem(CLAVE_SONIDO) !== 'mudo'
  } catch {
    return true
  }
}

/**
 * Deja recordado el mudo de este televisor.
 *
 * Si el almacenamiento esta bloqueado o lleno no se insiste: el mudo vale para
 * esta sesion igual, solo que no sobrevive a la recarga. Silenciar la sala es
 * lo urgente; recordarlo es lo comodo, y lo comodo no puede romper lo urgente.
 */
function guardarSonido(activo: boolean) {
  try {
    localStorage.setItem(CLAVE_SONIDO, activo ? 'suena' : 'mudo')
  } catch {
    // Ver arriba.
  }
}

export default function PantallaPublicaPage() {
  const [activo, setActivo] = useState(false)
  const [conexion, setConexion] = useState<EstadoConexionEnVivo>('reconectando')
  /*
    Arranca con sonido y se corrige al montar, como el resto de lo que depende
    del navegador: en el servidor no hay `localStorage` que leer, y pintar en
    el servidor una cosa y en el cliente otra rompe la hidratacion.
  */
  const [sonidoActivo, setSonidoActivo] = useState(true)
  const [pantallaCompleta, setPantallaCompleta] = useState(false)
  // Ancho real de la pantalla donde esta puesta, para repartir las tarjetas.
  // Arranca en un valor de televisor y se corrige al montar: en el servidor no
  // hay ventana que medir.
  const [anchoVentana, setAnchoVentana] = useState(1920)

  const [configuracion, setConfiguracion] = useState<ConfiguracionSistema>(CONFIGURACION_POR_DEFECTO)

  /**
   * Si el servidor ya dijo QUE ASPECTO tiene que tener esta pantalla.
   *
   * EXISTE PARA NO ENSEÑAR EL DISEÑO EQUIVOCADO. `CONFIGURACION_POR_DEFECTO`
   * trae `disenoPantalla: 'CUADRICULA'`, asi que sin esto el televisor pintaba
   * la cuadricula en el primer dibujado y saltaba a la cartelera un instante
   * despues, cuando llegaba la respuesta. En la sala de espera eso se ve como
   * un parpadeo a la configuracion anterior, y parece que el cambio no se
   * hubiera guardado.
   *
   * No afecta al resto de la configuracion: el volumen o el mensaje del pie
   * pueden empezar con el valor de por defecto sin que se note. Lo que no
   * admite provisionalidad es el aspecto, porque cambia la pantalla entera.
   */
  const [configuracionCargada, setConfiguracionCargada] = useState(false)
  // Una entrada por modulo activo, en el mismo orden que entrega el servidor.
  // Nunca se reordena ni se quita por tiempo: solo cambia el contenido de la
  // casilla cuyo modulo llamo o se libero.
  const [casillas, setCasillas] = useState<CasillaPantalla[]>([])
  // Un solo modulo resaltado a la vez: el foco sigue al llamado mas reciente,
  // no se queda pegado en el anterior mientras ya se esta llamando a otro.
  const [resaltado, setResaltado] = useState<string | null>(null)

  // Un unico reloj para los dos diseños (ver `useAhora`). La cuadricula lo
  // pinta con su propio `Reloj` abajo; la cartelera lo recibe ya formateado.
  const ahora = useAhora()

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

  // El mudo de ESTE televisor, recuperado al montar.
  //
  // Sin esto se perdia en cada recarga, y un televisor de sala de espera se
  // recarga mas de lo que parece: corte de luz, reinicio del equipo, o
  // simplemente porque lo vuelven a abrir cada mañana. La sala que alguien
  // dejo en silencio a proposito amanecia sonando otra vez.
  useEffect(() => {
    setSonidoActivo(leerSonidoGuardado())
  }, [])

  useEffect(() => {
    sonidoRef.current = sonidoActivo
    // Al silenciar hay que vaciar la cola: si no, las campanadas que ya estaban
    // esperando su segundo salen igual despues de pulsar el boton de mudo.
    if (!sonidoActivo) campana.reiniciar()
  }, [sonidoActivo, campana])

  /**
   * Silencia o devuelve el sonido a ESTE televisor, y lo deja recordado.
   *
   * Guardar fuera del actualizador de estado y no dentro: React puede llamar
   * al actualizador dos veces para comprobar que es puro, y escribir en el
   * almacenamiento desde ahi es justo lo que esa comprobacion busca cazar.
   * Aqui el valor siguiente se calcula una vez y se usa para las dos cosas.
   */
  const alternarSonido = useCallback(() => {
    // `sonidoRef` va siempre al dia (lo sincroniza el efecto de arriba), asi
    // que sirve para leer el valor actual sin volver a crear este manejador en
    // cada cambio: la barra de controles esta memoizada y una funcion nueva la
    // haria repintarse cada vez que alguien toca el mudo.
    const siguiente = !sonidoRef.current
    setSonidoActivo(siguiente)
    guardarSonido(siguiente)
  }, [])

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
      .then((respuesta) => respuesta.json())
      .then((estado) => {
        if (estado.configuracion) setConfiguracion(estado.configuracion)
        // Ya se sabe que aspecto toca. Se marca aunque la respuesta venga sin
        // configuracion: en ese caso la buena es la de por defecto, y dejarlo
        // sin marcar mantendria el televisor esperando para siempre.
        setConfiguracionCargada(true)
        if (eventosAplicadosRef.current !== eventosAlPedir) return

        setCasillas(estado.casillas ?? [])
      })
      .catch(() => {
        // Ni siquiera se pudo preguntar (servidor caido, red). Se sigue
        // adelante con la configuracion de por defecto: una sala de espera con
        // la pantalla en blanco es peor que una con el diseño de siempre, y el
        // aviso de conexion perdida ya lo da el indicador.
        setConfiguracionCargada(true)
      })
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

    // El administrador guardo la configuracion: puede haber cambiado el diseño
    // de la pantalla, el mensaje del pie, el volumen o la imagen de fondo. No
    // viene nada dentro del evento (este canal no tiene sesion): se vuelve a
    // pedir el estado, que es el unico sitio que decide que sale hacia aqui.
    if (evento.tipo === 'configuracion.cambiada') {
      cargarEstado()
      return
    }

    if (evento.tipo === 'modulo.liberado') {
      const { moduloId } = evento
      setCasillas((previas) =>
        previas.map((c) => (c.moduloId === moduloId ? casillaLibreDesde(c) : c)),
      )
    }
  }, [campana, resaltar, cargarEstado])

  /**
   * El canal de eventos, el MISMO que vigila el resto del sistema.
   *
   * Aqui se abria un `EventSource` a mano que solo reaccionaba a `onerror`, y
   * un SSE se muere en silencio mas a menudo de lo que parece: vence el NAT,
   * un proxy se traga los paquetes, el televisor salta de wifi. El navegador
   * deja la conexion en `OPEN` y no avisa nunca. En este televisor —encendido
   * dias seguidos— ese es el fallo esperable, no el raro, y su consecuencia no
   * es cosmetica: la resincronizacion del minuto repinta las casillas, PERO NO
   * SUENA LA CAMPANA, porque la campana solo la dispara un evento de llamado.
   * La sala de espera no levanta la vista y el paciente pierde su turno.
   *
   * `crearCanalEnVivo` trae el vigia que rehace la conexion cuando deja de
   * llegar hasta el latido, y deja el indicador diciendo la verdad.
   *
   * LA CAMPANA SIGUE SONANDO SOLO CON UN LLAMADO NUEVO: lo que llega por
   * `alCambiarLosDatos` son eventos (el latido queda filtrado dentro del
   * canal), y `alConectar` solo resincroniza, que no suena.
   */
  useEffect(() => {
    if (!activo) return

    const canal = crearCanalEnVivo({
      alConectar: () => {
        setConexion('en-vivo')
        // Al (re)conectar puede haberse perdido algun evento: resincronizamos.
        cargarEstado()
      },
      alPerderse: () => setConexion('reconectando'),
      alCambiarLosDatos: manejarEvento,
    })

    return () => {
      canal.cerrar()
      setConexion('reconectando')
    }
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

  /*
   * EL ASPECTO LO ELIGE EL ADMINISTRADOR, Y SE DECIDE AQUI.
   *
   * Los dos diseños reciben EXACTAMENTE los mismos datos y el mismo resalte:
   * este punto solo escoge como se dibujan. Por eso cambiar de diseño no puede
   * alterar a quien se llama, en que orden, ni cuando suena la campana —todo
   * eso ya paso mas arriba, antes de llegar a esta linea.
   *
   * La campana y la resincronizacion viven en el componente padre justamente
   * para eso: si cada diseño llevara la suya, cambiar de aspecto podria dejar
   * una sala sin aviso sonoro y nadie lo notaria hasta que un paciente se
   * pasara el turno.
   */
  /*
   * Mientras no se sepa el aspecto, NO se dibuja ninguno de los dos.
   *
   * Es una espera de milisegundos contra el propio servidor, y se resuelve
   * sola tanto si contesta como si falla (ver `cargarEstado`). Preferir un
   * instante de fondo liso a pintar la cuadricula y saltar a la cartelera:
   * el salto se lee desde la sala como un fallo del sistema.
   */
  if (!configuracionCargada) {
    return <main className="h-screen bg-[var(--turnos-bg)]" aria-busy="true" />
  }

  if (configuracion.disenoPantalla === 'CARTELERA') {
    return (
      <Cartelera
        casillas={casillas}
        configuracion={configuracion}
        resaltado={resaltado}
        hora={ahora ? horaColombiana(ahora) : null}
        controles={
          <ControlesPantalla
            conexion={conexion}
            sonidoActivo={sonidoActivo}
            alternarSonido={alternarSonido}
            pantallaCompleta={pantallaCompleta}
            alternarPantallaCompleta={alternarPantallaCompleta}
            tono="oscuro"
          />
        }
      />
    )
  }

  /*
   * EL FONDO DEJA DE SER GRIS Y PASA AL AZUL MUY CLARO DE LA CASA.
   *
   * Con `bg-slate-100`, un gris neutro, las fichas blancas se recortaban poco
   * y la pantalla entera se veia apagada —"de computador"—. El fondo
   * institucional (el mismo `--turnos-bg` del resto del sistema) es un azul lo
   * bastante claro para no competir y lo bastante tenido para que el blanco de
   * las fichas salte hacia delante. Ademas la sala de espera pasa a verse de la
   * misma familia que el resto de pantallas del hospital.
   */
  return (
    <main className="relative flex h-screen flex-col overflow-hidden bg-[var(--turnos-bg)] text-slate-900">
      {/*
        La MISMA imagen institucional que la cartelera, pero mucho mas atenuada
        (ver `FondoPantalla`): aqui la pantalla la llenan fichas blancas y la
        foto solo asoma entre ellas. A esa intensidad aporta color y textura de
        fondo —la sala deja de verse como una hoja de calculo— sin quitarle ni
        un gramo de atencion a los turnos, que es lo unico que el paciente
        viene a leer.
      */}
      <FondoPantalla ruta={configuracion.fondoPantalla} intensidad="cuadricula" />

      {/*
        La cabecera se separa con su propia sombra en lugar de con una linea
        de 1px: a distancia, un filete gris no se ve, y la cabecera parecia
        pegada al contenido. Con sombra se lee como una barra apoyada encima.

        Semitransparente con desenfoque, para que la imagen de fondo se intuya
        por detras en vez de cortarse en seco contra una franja blanca.
      */}
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-6 bg-white/85 px-8 py-5 shadow-[0_1px_0_rgba(10,38,52,.06),0_6px_18px_rgba(10,38,52,.05)] backdrop-blur-md">
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
          <Reloj />
          {/* Los mismos mandos que la cartelera, desde un solo sitio. */}
          <ControlesPantalla
            conexion={conexion}
            sonidoActivo={sonidoActivo}
            alternarSonido={alternarSonido}
            pantallaCompleta={pantallaCompleta}
            alternarPantallaCompleta={alternarPantallaCompleta}
          />
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
      <div className="relative z-10 min-h-0 flex-1 overflow-hidden p-6">
        {casillas.length === 0 ? (
          <div className="grid h-full place-items-center">
            <p className="text-2xl font-bold text-slate-400">Aun no hay consultorios ni ventanillas activos.</p>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-6" style={{ '--escala': escala } as React.CSSProperties}>
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
                  {/*
                    El nombre del servicio deja de ser una barra de color de
                    lado a lado y pasa a ser una ETIQUETA del ancho de su
                    texto.

                    Ocupando toda la fila competia con las fichas, que es lo
                    que el paciente tiene que mirar; ajustada al contenido y
                    con forma de pastilla se lee como un rotulo que clasifica
                    el bloque, no como otro elemento mas reclamando atencion.
                  */}
                  <h2 className="w-fit shrink-0 rounded-full bg-brand-100 px-5 py-1.5 text-[clamp(1.15rem,3vmin,2.6rem)] font-extrabold uppercase leading-tight tracking-[0.03em] text-brand-900">
                    {grupo.nombre}
                  </h2>
                  {/* Mas aire entre fichas: pegadas, la pared de tarjetas se
                      lee como una sola mancha desde lejos. */}
                  <div
                    className="grid min-h-0 flex-1 gap-4"
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
        <footer className="relative z-10 shrink-0 overflow-hidden whitespace-nowrap bg-brand-950 px-8 py-3 text-center text-lg font-medium tracking-[0.01em] text-white">
          {configuracion.mensajePie}
        </footer>
      ) : null}
    </main>
  )
}

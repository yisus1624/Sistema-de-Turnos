'use client'

/**
 * Pantalla de visualizacion para los usuarios (requerimiento seccion 10).
 *
 * Sin autenticacion a proposito: se abre en el televisor de la sala de espera.
 * Todo lo que llega aqui viene ya enmascarado desde el servidor.
 *
 * DISEÑO: el turno NO se pasa solo, lo pasa el doctor o el operador al pulsar
 * "siguiente". Por eso cada casilla (UNA POR MODULO, consultorio o ventanilla)
 * solo cambia cuando llega el evento de ese modulo puntual; nunca desaparece
 * por el paso del tiempo. Se ven todas a la vez, ajustadas al televisor que
 * toque; solo si ni con la letra minima caben, se reparten en paginas que
 * rotan, y la rotacion salta a la pagina del consultorio que acaba de llamar
 * (ver `planDeCuadricula` y `decidirPagina`).
 *
 * SIN PORTADA. La pantalla pinta los turnos y abre el canal en cuanto carga:
 * tras un apagon o un reinicio del PC, el televisor vuelve solo. El gesto de
 * una persona solo hace falta para el sonido, y ni eso en el kiosco (ver
 * `useAudioDelTelevisor`).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventoTurno } from '@/lib/realtime/hub'
import { crearCanalEnVivo, useReintento, type EstadoConexionEnVivo } from '@/lib/hooks'
import { CONFIGURACION_INICIAL } from '@/lib/turnos/configuracion-inicial'
import type { CasillaPantalla, ConfiguracionSistema } from '@/lib/turnos/types'
import { CampanaDeLlamado, desbloquearAudio, sonarCampana } from '@/lib/turnos/anuncio'
import {
  avisoDeSonido,
  eventoPideResincronizar,
  mensajeSinCasillas,
  type EstadoDeCarga,
} from '@/lib/turnos/pantalla-tv'
import { decidirLlamadoEnVivo, mezclarFotoDePantalla } from '@/lib/turnos/mezcla-pantalla'
import { claveDeCasilla } from '@/lib/turnos/casillas'
import Cartelera from './Cartelera'
import DisenoCuadricula from './DisenoCuadricula'
import { horaColombiana, useAhora } from './Reloj'
import ControlesPantalla from './ControlesPantalla'
import { useResaltes } from './useResaltes'
import { useAudioDelTelevisor } from './useAudioDelTelevisor'


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
 * Cuanto se espera la respuesta del estado completo antes de abandonarla.
 *
 * Sin limite, con la red degradada las consultas se quedaban colgadas minutos
 * y se iban apilando (una por minuto, una por reconexion): el navegador solo
 * abre seis conexiones por servidor, y con ellas ocupadas el canal en vivo ya
 * no conseguia reconectar. Abandonarla no pierde nada: la siguiente
 * reconexion o el refresco del minuto vuelven a pedirla.
 */
const MS_LIMITE_ESTADO = 10000

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

/**
 * La hora del servidor que viaja con la foto, o la del televisor si no llego.
 *
 * El PC del televisor puede tener el reloj descuadrado minutos; decidir con el
 * si un llamado es "reciente" hacia sonar los viejos o callar los nuevos.
 */
function horaDelServidor(ahora: unknown): number {
  const ms = typeof ahora === 'string' ? Date.parse(ahora) : Number.NaN
  return Number.isFinite(ms) ? ms : Date.now()
}

/** Lo que responde `/api/turnos/pantalla` (del propio servidor). */
interface FotoDePantalla {
  casillas?: CasillaPantalla[]
  configuracion?: ConfiguracionSistema
  ahora?: string
}

/** Marca de la cancelacion propia, para no confundirla con un fallo de red. */
const CANCELADA_POR_LA_PANTALLA = 'cancelada-por-la-pantalla'

async function pedirFotoDePantalla(signal: AbortSignal): Promise<FotoDePantalla> {
  const respuesta = await fetch('/api/turnos/pantalla', { cache: 'no-store', signal })
  if (!respuesta.ok) throw new Error(`La pantalla no pudo ponerse al dia (estado ${respuesta.status}).`)
  return respuesta.json()
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

/**
 * Pone la casilla de un llamado en su puesto: reemplaza la de ese puesto, o
 * la casilla LIBRE de su consultorio, o se añade al final. Un consultorio
 * puede tener varios doctores a la vez y cada uno tiene su fila.
 */
function colocarLlamado(previas: CasillaPantalla[], casilla: CasillaPantalla): CasillaPantalla[] {
  const clave = claveDeCasilla(casilla)
  if (previas.some((c) => claveDeCasilla(c) === clave)) {
    return previas.map((c) => (claveDeCasilla(c) === clave ? casilla : c))
  }
  const libre = previas.findIndex((c) => c.moduloId === casilla.moduloId && !c.codigo)
  if (libre >= 0) return previas.map((c, i) => (i === libre ? casilla : c))
  return [...previas, casilla]
}

/**
 * Libera un puesto. Si su consultorio tiene otros doctores atendiendo, la
 * fila se quita; si era el unico, la casilla queda libre como antes.
 */
function liberarPuesto(previas: CasillaPantalla[], clave: string): CasillaPantalla[] {
  const liberada = previas.find((c) => claveDeCasilla(c) === clave)
  if (!liberada) return previas
  const otrosDelConsultorio = previas.some((c) => c !== liberada && c.moduloId === liberada.moduloId)
  if (otrosDelConsultorio) return previas.filter((c) => c !== liberada)
  return previas.map((c) => (c === liberada ? { ...casillaLibreDesde(c), puesto: undefined } : c))
}

export default function PantallaPublicaPage() {
  const [conexion, setConexion] = useState<EstadoConexionEnVivo>('reconectando')
  /*
    Arranca con sonido y se corrige al montar, como el resto de lo que depende
    del navegador: en el servidor no hay `localStorage` que leer, y pintar en
    el servidor una cosa y en el cliente otra rompe la hidratacion.
  */
  const [sonidoActivo, setSonidoActivo] = useState(true)
  const [pantallaCompleta, setPantallaCompleta] = useState(false)

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
  // Si ya llegaron datos del servidor. Sin esto, una primera carga fallida se
  // leia en la sala como "no hay consultorios" (ver `mensajeSinCasillas`).
  const [estadoDeCarga, setEstadoDeCarga] = useState<EstadoDeCarga>('cargando')
  // Una entrada por modulo activo, en el mismo orden que entrega el servidor.
  // Nunca se reordena ni se quita por tiempo: solo cambia el contenido de la
  // casilla cuyo modulo llamo o se libero.
  const [casillas, setCasillas] = useState<CasillaPantalla[]>([])
  // Los llamados recientes, cada uno con su reloj: varios pueden quedar
  // resaltados a la vez (ver `useResaltes`).
  const { resaltes, resaltar, apagar } = useResaltes()

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
  // Cuantos eventos en vivo ha recibido cada modulo. Sirve para saber que
  // casillas de una resincronizacion que ya venia de camino quedaron obsoletas
  // (ver `cargarEstado`). Solo cuentan los eventos que cambian una casilla.
  const eventosPorModuloRef = useRef<Map<string, number>>(new Map())
  // Lo pintado AHORA MISMO, al dia en el instante (el estado de React solo lo
  // esta tras el siguiente render). Los eventos y la resincronizacion escriben
  // aqui y en el estado a la vez, para que ninguno trabaje sobre una copia
  // vieja del otro.
  const casillasRef = useRef<CasillaPantalla[]>([])
  // La consulta de estado en curso, para cancelarla si sale otra mas nueva, y
  // el numero de la ultima, para ignorar respuestas que lleguen desordenadas.
  const consultaRef = useRef<AbortController | null>(null)
  const ultimaConsultaRef = useRef(0)

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
    // Es un gesto: se aprovecha para soltar el audio del navegador.
    if (siguiente) void desbloquearAudio()
  }, [])

  // Al cerrar la pantalla no puede quedar ningun temporizador de campana vivo.
  useEffect(() => {
    return () => campana.reiniciar()
  }, [campana])
  useEffect(() => {
    configuracionRef.current = configuracion
  }, [configuracion])
  const aplicarCasillas = useCallback((cambiar: (previas: CasillaPantalla[]) => CasillaPantalla[]) => {
    const siguientes = cambiar(casillasRef.current)
    casillasRef.current = siguientes
    setCasillas(siguientes)
  }, [])

  const ajustesDeSonido = useCallback(
    () => ({
      sonidoActivo: sonidoRef.current,
      audioDelHospital: configuracionRef.current.audioActivo,
      volumen: configuracionRef.current.volumen,
    }),
    [],
  )
  const { audio, activarSonido } = useAudioDelTelevisor(ajustesDeSonido)
  const aviso = avisoDeSonido({ audio, mudoDelTelevisor: !sonidoActivo, audioDelHospital: configuracion.audioActivo })

  // Si una carga falla, se reintenta sola con espera creciente hasta lograrlo,
  // sin esperar al refresco del minuto ni a que el canal se reconecte.
  const cargarEstadoRef = useRef<() => void>(() => {})
  const reintentoDeCarga = useReintento()

  /** Una campanada, si este televisor y la configuracion lo permiten. */
  const anunciar = useCallback(() => {
    if (sonidoRef.current && configuracionRef.current.audioActivo) {
      campana.anunciar(configuracionRef.current.volumen)
    }
  }, [campana])

  /** Los modulos que recibieron un evento desde `eventosAlPedir`: su foto ya es vieja. */
  const modulosTocadosDesde = useCallback((eventosAlPedir: Map<string, number>) => {
    const tocados = new Set<string>()
    for (const [moduloId, cuenta] of eventosPorModuloRef.current) {
      if (eventosAlPedir.get(moduloId) !== cuenta) tocados.add(moduloId)
    }
    return tocados
  }, [])

  /**
   * Aplica la foto del servidor. Los llamados que traia y la pantalla no habia
   * visto (ocurridos durante un corte) suenan una vez cada uno, como si
   * hubieran llegado en vivo; el resalte va al mas reciente.
   */
  const aplicarFoto = useCallback(
    (estado: FotoDePantalla, eventosAlPedir: Map<string, number>) => {
      if (estado.configuracion) setConfiguracion(estado.configuracion)
      // Ya se sabe que aspecto toca, aunque la respuesta venga sin
      // configuracion: la buena es entonces la de por defecto.
      setConfiguracionCargada(true)
      if (!Array.isArray(estado.casillas)) return
      setEstadoDeCarga('listo')

      const tocados = modulosTocadosDesde(eventosAlPedir)
      const fotoCasillas = estado.casillas
      let llamados: string[] = []
      aplicarCasillas((previas) => {
        const mezcla = mezclarFotoDePantalla(previas, fotoCasillas, tocados, horaDelServidor(estado.ahora))
        llamados = mezcla.llamadosNuevos
        return mezcla.casillas
      })
      llamados.forEach(() => anunciar())
      const ultimo = llamados.at(-1)
      if (ultimo) resaltar(ultimo)
    },
    [aplicarCasillas, anunciar, resaltar, modulosTocadosDesde],
  )

  /**
   * No se pudo preguntar (servidor caido, red, limite de tiempo). Se sigue con
   * lo que ya se ve —una sala con la pantalla en blanco es peor que una con el
   * diseño de siempre— y se reintenta sola con espera creciente.
   */
  const alFallarLaCarga = useCallback(() => {
    setConfiguracionCargada(true)
    setEstadoDeCarga((actual) => (actual === 'listo' ? actual : 'sin_conexion'))
    reintentoDeCarga.programar(() => cargarEstadoRef.current())
  }, [reintentoDeCarga])

  /**
   * Resincronizacion completa, sin pisar lo que acaba de pasar.
   *
   * La foto es del momento en que el servidor respondio. Si mientras viajaba
   * llega un llamado por SSE, aplicarla despues BORRARIA ese llamado: por eso
   * se cuenta cuantos eventos recibio cada consultorio y los que cambiaron
   * durante el viaje conservan lo pintado (ver `mezclarFotoDePantalla`).
   *
   * Una respuesta que no sea la ultima pedida se ignora, y la cancelacion
   * PROPIA (otra consulta mas nueva, o la pantalla que se cierra) no cuenta
   * como fallo: no programa reintentos.
   */
  const cargarEstado = useCallback(() => {
    consultaRef.current?.abort(CANCELADA_POR_LA_PANTALLA)
    const consulta = new AbortController()
    consultaRef.current = consulta
    const numero = ++ultimaConsultaRef.current
    const limite = setTimeout(() => consulta.abort(), MS_LIMITE_ESTADO)
    const eventosAlPedir = new Map(eventosPorModuloRef.current)
    const esLaUltima = () => numero === ultimaConsultaRef.current && consulta.signal.reason !== CANCELADA_POR_LA_PANTALLA

    pedirFotoDePantalla(consulta.signal)
      .then((estado) => {
        if (!esLaUltima()) return
        reintentoDeCarga.exito()
        aplicarFoto(estado, eventosAlPedir)
      })
      .catch(() => {
        if (esLaUltima()) alFallarLaCarga()
      })
      .finally(() => {
        clearTimeout(limite)
        if (consultaRef.current === consulta) consultaRef.current = null
      })
  }, [aplicarFoto, alFallarLaCarga, reintentoDeCarga])

  useEffect(() => {
    cargarEstadoRef.current = cargarEstado
  }, [cargarEstado])

  useEffect(() => {
    return () => consultaRef.current?.abort(CANCELADA_POR_LA_PANTALLA)
  }, [])

  useEffect(() => {
    cargarEstado()
  }, [cargarEstado])

  const manejarEvento = useCallback((evento: EventoTurno) => {
    // Se cuenta ANTES de aplicar nada: cualquier resincronizacion que este de
    // camino trae una foto anterior a este evento y no debe pisar la casilla de
    // ese modulo. Solo cuentan los eventos que cambian una casilla: una
    // llegada registrada en admision no tiene por que invalidar nada.
    const contar = (moduloId: string) => {
      const mapa = eventosPorModuloRef.current
      mapa.set(moduloId, (mapa.get(moduloId) ?? 0) + 1)
    }

    if (evento.tipo === 'turno.llamado') {
      const { casilla } = evento
      const clave = claveDeCasilla(casilla)
      contar(clave)

      // Un llamado de un modulo que no esta en la cuadricula.
      //
      // La cuadricula se arma con los modulos ACTIVOS del momento en que se
      // pidio el estado. Si el administrador activa un consultorio despues, su
      // casilla no existe aqui todavia: el `map` de abajo no encuentra a quien
      // reemplazar, asi que sonaba la campana y en la pantalla no aparecia
      // nada. El paciente oye que pasa un turno, mira, y no ve su numero por
      // ningun lado hasta la siguiente resincronizacion, que puede tardar un
      // minuto. Pedir el estado completo trae la casilla nueva de inmediato.
      const pintada = casillasRef.current.find((c) => claveDeCasilla(c) === clave)
      if (!pintada) cargarEstado()

      // Solo se reemplaza la casilla de ESE puesto (consultorio + doctor); las
      // demas quedan intactas. Si el puesto es nuevo (el primer llamado de ese
      // doctor en ese consultorio), ocupa la casilla libre del consultorio o se
      // añade: varios doctores pueden atender a la vez en el mismo consultorio.
      aplicarCasillas((previas) => colocarLlamado(previas, casilla))

      // La resincronizacion pudo traer este mismo llamado un instante antes que
      // el evento (se publica despues de guardarse), y ya sono: no se repite.
      if (decidirLlamadoEnVivo(pintada, casilla) === 'reemplazar_en_silencio') return
      resaltar(clave)

      // UNA campanita POR LLAMADO, no una por tanda.
      //
      // Si dos o tres consultorios pasan paciente casi al tiempo, sus eventos
      // llegan aqui con milisegundos de diferencia. La campana se encarga de
      // separarlos un segundo entre si (ver `MS_SEPARACION`): asi la sala
      // cuenta de oido cuantos turnos pasaron, en vez de oir las tres campanadas
      // solapadas como un solo sonido. Que turno es y a que consultorio va lo
      // sigue diciendo la pantalla.
      anunciar()
      return
    }

    // El administrador guardo la configuracion: puede haber cambiado el diseño
    // de la pantalla, el mensaje del pie, el volumen o la imagen de fondo. No
    // viene nada dentro del evento (este canal no tiene sesion): se vuelve a
    // pedir el estado, que es el unico sitio que decide que sale hacia aqui.
    if (eventoPideResincronizar(evento)) {
      cargarEstado()
      return
    }

    if (evento.tipo === 'modulo.liberado') {
      const clave = evento.puesto ?? evento.moduloId
      contar(clave)
      aplicarCasillas((previas) => liberarPuesto(previas, clave))
      return
    }

    // El doctor retrocedio al turno anterior: su puesto vuelve a mostrar al
    // paciente de antes (o queda libre), EN SILENCIO y sin marca de "NUEVO".
    // No es un llamado: es deshacer uno que no debio pasar.
    if (evento.tipo === 'turno.devuelto') {
      contar(evento.puesto)
      apagar(evento.puesto)
      const { casilla } = evento
      aplicarCasillas((previas) =>
        casilla ? colocarLlamado(previas, casilla) : liberarPuesto(previas, evento.puesto),
      )
    }
  }, [aplicarCasillas, anunciar, resaltar, apagar, cargarEstado])

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
   * LA CAMPANA SUENA UNA VEZ POR LLAMADO: por el evento en vivo, o por la
   * resincronizacion de `alConectar` cuando trae llamados recientes que la
   * pantalla no vio (ocurridos durante un corte, ver `mezclarFotoDePantalla`).
   * Si los dos traen el mismo llamado, el segundo ya no suena (ver
   * `decidirLlamadoEnVivo`). El latido queda filtrado dentro del canal.
   */
  useEffect(() => {
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
  }, [manejarEvento, cargarEstado])

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
    const id = setInterval(cargarEstado, MS_RESINCRONIZAR)
    return () => clearInterval(id)
  }, [cargarEstado])

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
        resaltes={resaltes}
        hora={ahora ? horaColombiana(ahora) : null}
        mensajeSinLlamados={estadoDeCarga === 'listo' ? 'Aun no se ha llamado ningun turno.' : mensajeSinCasillas(estadoDeCarga)}
        controles={
          <ControlesPantalla
            conexion={conexion}
            avisoSonido={aviso}
            activarSonido={activarSonido}
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

  return (
    <DisenoCuadricula
      casillas={casillas}
      configuracion={configuracion}
      resaltes={resaltes}
      mensajeVacio={mensajeSinCasillas(estadoDeCarga)}
      controles={
        <ControlesPantalla
          conexion={conexion}
          avisoSonido={aviso}
          activarSonido={activarSonido}
          sonidoActivo={sonidoActivo}
          alternarSonido={alternarSonido}
          pantallaCompleta={pantallaCompleta}
          alternarPantallaCompleta={alternarPantallaCompleta}
        />
      }
    />
  )
}

'use client'

/**
 * Vista general de la operacion del dia (requerimiento secciones 8 y 13).
 *
 * Se actualiza sola: escucha los mismos eventos en vivo que la pantalla de la
 * sala de espera y se pone al dia sola cuando la conexion se restablece. El
 * indicador del encabezado dice si lo que se ve sigue siendo cierto.
 *
 * SE LEE POR SERVICIO, NO POR CONSULTORIO. Antes habia dos tableros separados:
 * uno con una casilla por modulo ("Consultorio 3 · T-245", "Consultorio 4 ·
 * libre") y otro debajo con el numero de gente esperando en cada servicio. Para
 * responder lo unico que se pregunta el administrador —"¿como va odontologia?"—
 * habia que cruzar los dos con la vista: el primero decia a quien estan
 * atendiendo pero no cuantos faltan, y el segundo cuantos faltan pero no quien
 * va adelante.
 *
 * Ahora es una tarjeta por servicio con su cola dentro, en el orden real de
 * atencion: primero quien esta siendo atendido, despues quien sigue. Los
 * consultorios no se pierden —van en cada fila, que es donde sirven: dicen a
 * donde tiene que ir ese paciente.
 *
 * LOS SERVICIOS SE ORDENAN POR CARGA. El que tiene mas gente en curso sale
 * primero. En orden alfabetico, el servicio atascado podia quedar al final de
 * la pantalla mientras arriba se veian tarjetas vacias.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CaretDown,
  CheckCircle,
  FirstAidKit,
  Ticket,
  UserSound,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Loader'
import { hoyEnColombia, horaCorta, pedir } from '@/lib/api/cliente'
import type { ResultadoDeCarga } from '@/lib/api/reintento'
import { useCargaConReintento, useLimitador, useNombresDeRespaldo, useRecargaEnVivo, useUltimaPeticion } from '@/lib/hooks'
import { conInactivosMarcados, conRespaldo } from '@/lib/turnos/nombres-de-respaldo'
import { cambiaLosCatalogos } from '@/lib/realtime/canal'
import { IndicadorConexion } from '@/components/ui/IndicadorConexion'
import { iconoDeServicio } from '@/components/ui/iconos-servicio'
import { TarjetaIndicador, TONOS_INDICADOR } from '@/components/ui/TarjetaIndicador'
import type { CasillaPantalla, Modulo, Profesional, Servicio, Turno } from '@/lib/turnos/types'

/** Cada cuanto, como mucho, se vuelve a pedir el dia completo (ver `useLimitador`). */
const MS_ENTRE_CARGAS_DEL_DIA = 5000

type Resumen = { enEspera: number; llamados: number; atendidos: number; ausentes: number }

function contar(turnos: Turno[]): Resumen {
  return {
    enEspera: turnos.filter((t) => t.estado === 'EN_ESPERA').length,
    llamados: turnos.filter((t) => t.estado === 'LLAMADO' || t.estado === 'EN_ATENCION').length,
    atendidos: turnos.filter((t) => t.estado === 'ATENDIDO').length,
    ausentes: turnos.filter((t) => t.estado === 'AUSENTE').length,
  }
}

/** Los estados que siguen vivos: los que caben en "turnos en curso". */
type EstadoEnCurso = 'EN_ESPERA' | 'LLAMADO' | 'EN_ATENCION'

function estaEnCurso(turno: Turno): boolean {
  return turno.estado === 'EN_ESPERA' || turno.estado === 'LLAMADO' || turno.estado === 'EN_ATENCION'
}

/**
 * Como se ve cada estado dentro de la cola de un servicio.
 *
 * El punto de color delante del texto no es decoracion: la etiqueta se lee de
 * reojo mientras se recorre una columna de veinte filas, y a ese ritmo el
 * color se reconoce antes que la palabra.
 */
const ESTILOS_EN_CURSO: Record<EstadoEnCurso, { etiqueta: string; chip: string; punto: string }> = {
  EN_ATENCION: {
    etiqueta: 'En atencion',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    punto: 'bg-emerald-500',
  },
  /*
   * Llamado no es lo mismo que en atencion, y por eso lleva su propio color:
   * la casilla ya lo canto por el altavoz pero el paciente todavia no ha
   * entrado. Pintarlo de verde como "en atencion" escondia justo a la persona
   * que puede no aparecer.
   */
  LLAMADO: {
    etiqueta: 'Llamado',
    chip: 'bg-acento-50 text-acento-700 ring-acento-100',
    punto: 'bg-acento-500',
  },
  EN_ESPERA: {
    etiqueta: 'En espera',
    chip: 'bg-amber-50 text-amber-700 ring-amber-100',
    punto: 'bg-amber-400',
  },
}

/**
 * Paleta de cada servicio.
 *
 * Se asigna por posicion del servicio en el tablero, no al azar, para que la
 * tarjeta de odontologia sea del mismo color en cada recarga: parte de lo que
 * hace rapido este tablero es que el ojo aprende donde esta cada servicio.
 *
 * El color pleno se queda en la barra lateral de la tarjeta —una linea fina—
 * y el disco del icono va en pastel. Con seis tarjetas pintadas a saturacion
 * completa el tablero se leia como una caja de lapices, y el color del
 * servicio pesaba mas que el estado de los turnos, que es lo que hay que ver.
 */
type PaletaServicio = { barra: string; disco: string; chip: string }

const PALETAS_SERVICIO: PaletaServicio[] = [
  { barra: 'bg-acento-500', disco: 'bg-acento-50 text-acento-600', chip: 'bg-acento-50 text-acento-700' },
  { barra: 'bg-emerald-500', disco: 'bg-emerald-50 text-emerald-600', chip: 'bg-emerald-50 text-emerald-700' },
  { barra: 'bg-violet-500', disco: 'bg-violet-50 text-violet-600', chip: 'bg-violet-50 text-violet-700' },
  { barra: 'bg-rose-500', disco: 'bg-rose-50 text-rose-600', chip: 'bg-rose-50 text-rose-700' },
  { barra: 'bg-amber-500', disco: 'bg-amber-50 text-amber-600', chip: 'bg-amber-50 text-amber-700' },
  { barra: 'bg-cyan-500', disco: 'bg-cyan-50 text-cyan-600', chip: 'bg-cyan-50 text-cyan-700' },
]

export default function TurnosEnCursoClient() {
  const [casillas, setCasillas] = useState<CasillaPantalla[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [profesionales, setProfesionales] = useState<Profesional[]>([])
  const [cargando, setCargando] = useState(true)
  /**
   * Cuando se trajeron estos datos por ultima vez.
   *
   * El semaforo de la conexion dice si el canal esta vivo; esto dice desde
   * cuando no llega nada nuevo, que no es lo mismo. Un canal abierto en un
   * servicio donde hoy no se ha movido nada tambien se queda quieto, y sin la
   * hora no hay forma de distinguir "no ha pasado nada" de "esto lleva una
   * hora congelado".
   */
  const [actualizado, setActualizado] = useState<string | null>(null)

  // Solo cuenta la ultima carga de cada cosa: con varios eventos seguidos, una
  // respuesta vieja que llegara tarde pisaria el tablero bueno.
  const cargasDeCatalogos = useUltimaPeticion()

  /**
   * Los catalogos (servicios, consultorios, profesionales): al abrir, y de
   * nuevo solo cuando cambian (ver `cambiaLosCatalogos`).
   *
   * Antes se volvian a pedir con cada evento del hospital, junto con el dia
   * completo: en hora pico, varias veces por minuto para traer lo mismo. Y
   * pedirlos solo al abrir tampoco bastaba: un servicio creado o una purga no
   * aparecian hasta recargar la pagina.
   */
  const cargarCatalogos = useCallback(async (): Promise<ResultadoDeCarga> => {
    const carga = cargasDeCatalogos.iniciar()
    const { signal } = carga
    const [catalogo, puntos, equipo] = await Promise.all([
      pedir<{ servicios: Servicio[] }>('/api/turnos/servicios', { signal }),
      // Los consultorios hacen falta para poner nombre al `moduloId` de cada
      // turno: la pantalla de la sala de espera solo trae los que estan
      // ocupados ahora mismo.
      pedir<{ modulos: Modulo[] }>('/api/turnos/modulos', { signal }),
      // Y los profesionales, para el consultorio del que TODAVIA espera: su
      // turno aun no tiene modulo (se pone al llamarlo), pero en admisiones ya
      // le dijeron a que consultorio va, el habitual de su doctor.
      pedir<{ profesionales: Profesional[] }>('/api/turnos/profesionales', { signal }),
    ])
    if (!carga.esVigente()) return 'reemplazada'
    setServicios(catalogo.servicios)
    setModulos(puntos.modulos)
    setProfesionales(equipo.profesionales)
  }, [cargasDeCatalogos])

  const cargasDeSala = useUltimaPeticion()
  const cargasDelDia = useUltimaPeticion()

  // Sin aviso si fallan: la hora de "actualizado" ya dice desde cuando no llega
  // nada, y `useCargaConReintento` lo vuelve a intentar solo.

  /** Quien esta en cada consultorio ahora: ligero (la sala va en cache), con cada evento. */
  const cargarSala = useCallback(async (): Promise<ResultadoDeCarga> => {
    const carga = cargasDeSala.iniciar()
    const pantalla = await pedir<{ casillas: CasillaPantalla[] }>('/api/turnos/pantalla', { signal: carga.signal })
    if (!carga.esVigente()) return 'reemplazada'
    setCasillas(pantalla.casillas)
  }, [cargasDeSala])

  /**
   * Los turnos del dia: la consulta pesada, limitada (ver abajo).
   *
   * La fecha se calcula en CADA carga, no al montar: esta pantalla vive abierta
   * en el puesto del administrador y tiene que pasar sola al dia siguiente.
   */
  const cargarDia = useCallback(async (): Promise<ResultadoDeCarga> => {
    const carga = cargasDelDia.iniciar()
    const historico = await pedir<{ turnos: Turno[] }>(`/api/turnos/historico?fecha=${hoyEnColombia()}`, {
      signal: carga.signal,
    }).finally(() => setCargando(false))
    if (!carga.esVigente()) return 'reemplazada'
    setTurnos(historico.turnos)
    setActualizado(new Date().toISOString())
  }, [cargasDelDia])

  // Las tres cargas se reintentan solas con espera creciente si fallan.
  const recargarCatalogos = useCargaConReintento(cargarCatalogos)
  const recargarSala = useCargaConReintento(cargarSala)
  const recargarDia = useCargaConReintento(cargarDia)

  /*
   * EL DIA COMPLETO, COMO MUCHO CADA POCOS SEGUNDOS. Se pedia con cada rafaga
   * de eventos, y en hora pico eso eran varias consultas pesadas por minuto
   * desde este monitor. Ahora va limitado y la sala sigue al instante: quien
   * esta en cada consultorio se ve en el acto, y las cuentas y las colas se
   * ponen al dia a los pocos segundos, sin perder el ultimo cambio.
   */
  const limitadorDelDia = useLimitador(MS_ENTRE_CARGAS_DEL_DIA, () => void recargarDia())

  const recargar = useCallback(() => {
    void recargarSala()
    limitadorDelDia.pedir()
  }, [recargarSala, limitadorDelDia])

  useEffect(() => {
    void recargarCatalogos()
  }, [recargarCatalogos])

  useEffect(() => {
    recargar()
  }, [recargar])

  // Eventos en vivo: `useRecargaEnVivo` ya junta en una sola recarga la rafaga
  // de eventos que llegan casi a la vez (ver `MS_AGRUPAR_EVENTOS`).
  const conexion = useRecargaEnVivo(recargar, {
    alEvento: (evento) => {
      if (cambiaLosCatalogos(evento)) void recargarCatalogos()
    },
    // Un servicio creado durante un corte no trae otro evento despues: sin
    // esto, su tarjeta no aparecia hasta el siguiente cambio de configuracion.
    alConectar: () => void recargarCatalogos(),
  })

  const resumen = contar(turnos)
  const respaldo = useNombresDeRespaldo()

  /** Nombre del consultorio de un turno, con el respaldo del doctor. */
  const nombreDeModulo = useMemo(() => {
    // Con el respaldo, un turno de un consultorio ya desactivado no queda sin nombre.
    const porModulo = new Map(conRespaldo(modulos, respaldo.modulos).map((modulo) => [modulo.id, modulo.nombre]))
    // Las casillas mandan sobre el catalogo: si el doctor se cambio hoy de
    // consultorio, lo cierto es lo que esta sonando en la sala de espera.
    for (const casilla of casillas) porModulo.set(casilla.moduloId, casilla.moduloNombre)

    const habitualDelProfesional = new Map(
      profesionales.filter((p) => p.moduloId).map((p) => [p.id, p.moduloId as string]),
    )

    return (turno: Turno) => {
      const id = turno.moduloId ?? (turno.profesionalId ? habitualDelProfesional.get(turno.profesionalId) : null)
      return id ? porModulo.get(id) ?? null : null
    }
  }, [modulos, respaldo, casillas, profesionales])

  /**
   * Los servicios que hoy estan funcionando, con su cola dentro.
   *
   * Se deducen de los turnos del dia y de las casillas de la pantalla, que es
   * lo que de verdad se movio hoy, no del catalogo: ahi figuran tambien los que
   * el hospital atiende otros dias. Si todavia no ha pasado nada —a primera
   * hora— se muestran todos, porque un tablero vacio al abrir se lee como que
   * el sistema no cargo.
   */
  const tableros = useMemo(() => {
    const idsDeHoy = new Set([
      ...turnos.map((t) => t.servicioId),
      ...casillas.map((c) => c.servicioId),
    ])
    // Con los desactivados: su turno en curso sigue ahi aunque el servicio ya no.
    const catalogo = conInactivosMarcados(servicios, respaldo.servicios)
    const deHoy = idsDeHoy.size > 0 ? catalogo.filter((s) => idsDeHoy.has(s.id)) : servicios

    return deHoy
      .map((servicio) => ({
        servicio,
        /*
          EL ORDEN ES EL DE LA ATENCION, no el del reloj ni el del codigo.
          Arriba quien ya esta con el doctor, debajo la cola por orden de
          llegada. Es como se lee una fila de verdad, y deja ver de un golpe
          "voy por el T-245 y me faltan seis".
        */
        cola: turnos
          .filter((turno) => turno.servicioId === servicio.id && estaEnCurso(turno))
          .sort((a, b) => {
            const peso = (turno: Turno) => (turno.estado === 'EN_ESPERA' ? 1 : 0)
            if (peso(a) !== peso(b)) return peso(a) - peso(b)
            const hora = (turno: Turno) => turno.horaLlamado ?? turno.fechaGeneracion
            return hora(a).localeCompare(hora(b))
          }),
        consultorios: [
          ...new Set(
            casillas
              .filter((casilla) => casilla.servicioId === servicio.id && casilla.codigo)
              .map((casilla) => casilla.moduloNombre),
          ),
        ],
      }))
      .sort((a, b) => b.cola.length - a.cola.length || a.servicio.nombre.localeCompare(b.servicio.nombre, 'es'))
  }, [servicios, respaldo, turnos, casillas])

  if (cargando) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Cargando la operacion del dia">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} padded={false} className="rounded-[1.375rem] p-5">
              <div className="flex items-start gap-3.5">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-2 h-8 w-12" />
                  <Skeleton className="mt-2 h-3 w-28" />
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card padded={false} className="rounded-[1.375rem]">
          <CardHeader>
            <Skeleton className="h-10 w-56" />
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-[1.25rem] border border-slate-200/70 p-4">
                  <Skeleton className="h-11 w-40" />
                  <Skeleton className="mt-3 h-7 w-full" />
                  <Skeleton className="mt-2 h-7 w-full" />
                  <Skeleton className="mt-2 h-7 w-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaIndicador
          icono={UsersThree}
          etiqueta="En espera"
          valor={resumen.enEspera}
          detalle="Pacientes en espera"
          tono={TONOS_INDICADOR.acento}
        />
        <TarjetaIndicador
          icono={UserSound}
          etiqueta="En atencion"
          valor={resumen.llamados}
          detalle="Llamados y siendo atendidos"
          tono={TONOS_INDICADOR.verde}
        />
        <TarjetaIndicador
          icono={CheckCircle}
          etiqueta="Atendidos"
          valor={resumen.atendidos}
          detalle="Hoy"
          tono={TONOS_INDICADOR.ambar}
        />
        {/*
          AUSENTES, NO "EN RETRASO". Es el paciente al que se llamo y no
          aparecio: el sistema lo sabe con certeza porque alguien lo marco. Un
          "en retraso" habria que inventarlo a partir de cuanto lleva esperando
          cada uno, y ese numero diria mas del ritmo del consultorio que del
          paciente.
        */}
        <TarjetaIndicador
          icono={WarningCircle}
          etiqueta="Ausentes"
          valor={resumen.ausentes}
          detalle="Llamados que no se presentaron"
          tono={TONOS_INDICADOR.rojo}
        />
      </div>

      <Card padded={false} className="rounded-[1.375rem]">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-acento-50 text-acento-600">
              <FirstAidKit size={20} weight="fill" />
            </span>
            <div className="min-w-0">
              <CardTitle>Puntos de atencion</CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Turnos en curso por servicio, igual que se ven en la sala de espera
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <IndicadorConexion estado={conexion} />
            {actualizado ? (
              <span className="text-xs font-medium tabular-nums text-slate-400">
                Actualizado {horaCorta(actualizado)}
              </span>
            ) : null}
          </div>
        </CardHeader>

        <CardContent>
          {tableros.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="Sin servicios configurados"
              description="Crea los servicios del hospital para que empiecen a generarse turnos."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {tableros.map((tablero, indice) => (
                <TarjetaServicio
                  key={tablero.servicio.id}
                  nombre={tablero.servicio.nombre}
                  consultorios={tablero.consultorios}
                  cola={tablero.cola}
                  paleta={PALETAS_SERVICIO[indice % PALETAS_SERVICIO.length]}
                  nombreDeModulo={nombreDeModulo}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** Cuantos turnos se ven antes de pedir la lista completa. */
const FILAS_VISIBLES = 3

/**
 * Un servicio y su cola.
 *
 * La tarjeta esta pensada para responder tres cosas de un vistazo y en este
 * orden: de que servicio es, cuanta gente tiene, y quien va ahora mismo.
 */
function TarjetaServicio({
  nombre,
  consultorios,
  cola,
  paleta,
  nombreDeModulo,
}: {
  nombre: string
  /** Consultorios que ahora mismo estan atendiendo este servicio. */
  consultorios: string[]
  cola: Turno[]
  paleta: PaletaServicio
  nombreDeModulo: (turno: Turno) => string | null
}) {
  /*
    La cola se muestra recortada porque un servicio con treinta esperando
    estiraria su tarjeta hasta descolocar la rejilla entera y dejaria las demas
    fuera de la pantalla. Los tres primeros son los que se miran; el resto se
    pide cuando se quiere.
  */
  const [completa, setCompleta] = useState(false)

  const visibles = completa ? cola : cola.slice(0, FILAS_VISIBLES)

  return (
    <div className="relative flex flex-col overflow-hidden rounded-[1.25rem] border border-slate-200/70 bg-white">
      <span className={`absolute inset-y-0 left-0 w-1 ${paleta.barra}`} aria-hidden="true" />

      <div className="flex items-start gap-3 py-3.5 pl-5 pr-4">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${paleta.disco}`}>
          {iconoDeServicio(nombre, 20)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight tracking-[-0.018em] text-brand-950">
            {nombre}
          </p>
          {/*
            Debajo del nombre va DONDE se esta atendiendo, que es la otra mitad
            de lo que se viene a saber aqui. Cuando no hay ningun consultorio
            abierto se dice, porque una cola que no avanza y una cola sin nadie
            atendiendola se ven igual y no son lo mismo.
          */}
          <p className="mt-0.5 truncate text-xs font-medium leading-tight text-slate-500">
            {consultorios.length > 0 ? consultorios.join(' · ') : 'Sin consultorio abierto'}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tracking-[0.015em] tabular-nums ${
            cola.length > 0 ? paleta.chip : 'bg-slate-100 text-slate-500'
          }`}
        >
          {cola.length} {cola.length === 1 ? 'paciente' : 'pacientes'}
        </span>
      </div>

      <div className="flex-1 border-t border-slate-100 px-2.5 py-2.5">
        {cola.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs font-medium leading-5 text-slate-400">
            Sin turnos en curso ahora mismo.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visibles.map((turno) => {
              const estilo = ESTILOS_EN_CURSO[turno.estado as EstadoEnCurso]
              const modulo = nombreDeModulo(turno)

              return (
                <li
                  key={turno.id}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-[var(--suave)] ease-[var(--curva)] hover:bg-slate-50"
                >
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.015em] ring-1 ${estilo.chip}`}
                  >
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${estilo.punto}`} />
                    {estilo.etiqueta}
                  </span>

                  <span className="shrink-0 text-sm font-semibold tabular-nums tracking-[-0.01em] text-brand-950">
                    {turno.codigo}
                  </span>

                  {modulo ? (
                    <>
                      <ArrowRight size={12} weight="bold" className="shrink-0 text-slate-300" />
                      <span className="truncate text-xs font-medium text-slate-500">{modulo}</span>
                    </>
                  ) : null}

                  <span className="ml-auto shrink-0 text-xs font-medium tabular-nums text-slate-400">
                    {horaCorta(turno.horaLlamado ?? turno.fechaGeneracion)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {cola.length > FILAS_VISIBLES ? (
        <button
          type="button"
          onClick={() => setCompleta((antes) => !antes)}
          aria-expanded={completa}
          className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-2.5 text-xs font-semibold text-slate-500 transition-colors duration-[var(--suave)] ease-[var(--curva)] hover:bg-slate-50 hover:text-acento-700"
        >
          {completa ? 'Ver solo los primeros' : `Ver los ${cola.length}`}
          <CaretDown
            size={13}
            weight="bold"
            className={`transition-transform duration-[var(--suave)] ${completa ? 'rotate-180' : ''}`}
          />
        </button>
      ) : null}
    </div>
  )
}

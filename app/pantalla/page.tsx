'use client'

/**
 * Pantalla de visualizacion para los usuarios (requerimiento seccion 10).
 *
 * Sin autenticacion a proposito: se abre en el televisor de la sala de espera.
 * Todo lo que llega aqui viene ya enmascarado desde el servidor.
 *
 * QUE PASA CUANDO VARIOS CONSULTORIOS LLAMAN CASI AL TIEMPO:
 *   - El panel grande no se reemplaza de golpe. Los llamados entran a una cola
 *     visual y cada uno se sostiene unos segundos, en el mismo orden en que se
 *     anuncian por audio.
 *   - La columna izquierda muestra TODOS los llamados recientes desde el primer
 *     instante, con su modulo. Asi, aunque el panel grande ya haya rotado, el
 *     paciente encuentra su turno sin esperar.
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

/** Cuanto se sostiene cada llamado en el panel grande antes de pasar al siguiente. */
const MS_EN_PANTALLA = 6000

const CONFIGURACION_POR_DEFECTO: ConfiguracionPantalla = {
  audioActivo: true,
  repeticionesAudio: 2,
  volumen: 1,
  ultimosVisibles: 5,
  mensajePie: '',
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

export default function PantallaPublicaPage() {
  const [activo, setActivo] = useState(false)
  const [conectado, setConectado] = useState(false)
  const [sonidoActivo, setSonidoActivo] = useState(true)
  const [voz, setVoz] = useState<SpeechSynthesisVoice | null>(null)

  const [configuracion, setConfiguracion] = useState<ConfiguracionPantalla>(CONFIGURACION_POR_DEFECTO)
  const [ultimos, setUltimos] = useState<CasillaPantalla[]>([])
  const [colaVisual, setColaVisual] = useState<CasillaPantalla[]>([])

  // Inicializacion perezosa: una sola cola por montaje, sin recrearla en cada render.
  const [cola] = useState(() => new ColaDeAnuncios(locutorNavegador))
  const sonidoRef = useRef(sonidoActivo)
  const vozRef = useRef(voz)
  const configuracionRef = useRef(configuracion)

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
        setUltimos(data.ultimos ?? [])
        if (data.configuracion) setConfiguracion(data.configuracion)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    cargarEstado()
  }, [cargarEstado])

  const manejarEvento = useCallback((evento: EventoTurno) => {
    if (evento.tipo !== 'turno.llamado') return

    const { casilla } = evento

    // La lista lateral se actualiza de inmediato: no espera a la cola visual.
    setUltimos((previos) => [
      casilla,
      ...previos.filter((c) => c.turnoId !== casilla.turnoId),
    ].slice(0, configuracionRef.current.ultimosVisibles))

    setColaVisual((previos) => [...previos, casilla])

    if (sonidoRef.current && configuracionRef.current.audioActivo) {
      sonarCampana(configuracionRef.current.volumen)
      cola.encolar(textoAnuncio(casilla), {
        voz: vozRef.current,
        repeticiones: configuracionRef.current.repeticionesAudio,
        volumen: configuracionRef.current.volumen,
      })
    }
  }, [cola])

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

  // Drena la cola visual: el ultimo llamado se queda fijo en el panel.
  useEffect(() => {
    if (colaVisual.length <= 1) return
    const id = setTimeout(() => setColaVisual((previos) => previos.slice(1)), MS_EN_PANTALLA)
    return () => clearTimeout(id)
  }, [colaVisual])

  function activarPantalla() {
    setActivo(true)
    // Gesto del usuario: desbloquea el autoplay de audio en el navegador.
    sonarCampana(1)
  }

  const destacado = colaVisual[0] ?? ultimos[0] ?? null
  const enEspera = Math.max(0, colaVisual.length - 1)

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

          {voz ? (
            <p className={`text-sm ${vozColombiana ? 'text-brand-200/80' : 'text-amber-300'}`}>
              {vozColombiana ? 'Voz del llamado: ' : 'Voz del llamado (no es colombiana): '}
              {voz.name}
            </p>
          ) : (
            <div className="mx-auto flex max-w-md items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-left text-sm text-amber-200">
              <WarningCircle size={22} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                Este equipo no tiene voces en español. El llamado saldra sin audio para no leerlo con
                voz extranjera. Instala la voz de español (Colombia) en Windows, o abre esta pantalla
                en Microsoft Edge.
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

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,34fr)_minmax(0,66fr)] gap-4 p-4">
        {/* Columna izquierda: llamados recientes, con su modulo. */}
        <section className="flex min-h-0 flex-col gap-2">
          <div className="grid shrink-0 grid-cols-2 overflow-hidden rounded-lg text-center text-lg font-black uppercase tracking-wide text-white">
            <span className="bg-brand-500 py-2">Turno</span>
            <span className="bg-brand-700 py-2">Modulo</span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            {ultimos.length === 0 ? (
              <p className="py-8 text-center text-xl font-bold text-slate-400">Aun no hay llamados.</p>
            ) : (
              ultimos.map((casilla, indice) => {
                const esActual = destacado?.turnoId === casilla.turnoId
                return (
                  <div
                    key={`${casilla.turnoId}-${casilla.vecesLlamado}`}
                    className={`shrink-0 overflow-hidden rounded-lg border transition-colors ${
                      esActual ? 'border-brand-500 bg-brand-500' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="grid grid-cols-2 text-center">
                      <span
                        className={`truncate py-2 text-2xl font-black ${
                          esActual ? 'text-white' : 'text-brand-800'
                        }`}
                      >
                        {casilla.codigo}
                      </span>
                      <span
                        className={`truncate border-l py-2 text-2xl font-black ${
                          esActual ? 'border-white/25 text-white' : 'border-slate-200 text-brand-800'
                        }`}
                      >
                        {casilla.moduloNombre}
                      </span>
                    </div>
                    {/*
                      El servicio va junto al paciente porque el hospital puede
                      tener muchos (consulta externa, pediatria, odontologia,
                      laboratorio...) y sin el, dos filas con el mismo numero de
                      consultorio serian indistinguibles.
                    */}
                    <div
                      className={`flex items-baseline justify-between gap-2 px-3 py-1.5 ${
                        esActual
                          ? 'bg-brand-600 text-white'
                          : indice === 0
                            ? 'bg-brand-100 text-brand-800'
                            : 'bg-slate-50 text-slate-600'
                      }`}
                    >
                      <span className="truncate text-xl font-bold">
                        {casilla.pacienteVisible ?? casilla.servicioNombre}
                      </span>
                      {casilla.pacienteVisible ? (
                        <span
                          className={`shrink-0 truncate text-xs font-black uppercase tracking-wide ${
                            esActual ? 'text-brand-100' : 'text-slate-400'
                          }`}
                        >
                          {casilla.servicioNombre}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* Panel principal: el llamado que se esta anunciando. */}
        <section className="flex min-h-0 flex-col gap-3">
          <div className="grid shrink-0 grid-cols-2 overflow-hidden rounded-lg text-center text-xl font-black uppercase tracking-wide text-white">
            <span className="bg-brand-500 py-2">Turno</span>
            <span className="bg-brand-700 py-2">Modulo</span>
          </div>

          {destacado?.codigo ? (
            <>
              <div
                key={`${destacado.turnoId}-${destacado.vecesLlamado}`}
                className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden rounded-lg motion-safe:animate-[pulse_1.1s_ease-in-out_1]"
              >
                <div className="grid min-w-0 place-items-center bg-brand-700 px-4">
                  <span className="truncate text-[clamp(2.5rem,9vw,9rem)] font-black leading-none tracking-[-0.04em] text-white">
                    {destacado.codigo}
                  </span>
                </div>
                {/*
                  El nombre del modulo es libre y puede ser largo ("Consultorio de
                  odontologia 2"), asi que la tipografia es mas pequena que la del
                  codigo y el texto puede partirse en varias lineas antes que
                  desbordarse fuera del bloque.
                */}
                <div className="grid min-w-0 place-items-center bg-brand-600 px-4">
                  <span className="w-full break-words text-center text-[clamp(1.5rem,4.5vw,4rem)] font-black leading-[1.05] tracking-[-0.02em] text-white">
                    {destacado.moduloNombre}
                  </span>
                </div>
              </div>

              {/*
                Los turnos de ventanilla no tienen paciente asociado, asi que en
                esos casos el servicio ocupa la linea grande en lugar de
                repetirse arriba y abajo.
              */}
              <div className="shrink-0 rounded-lg bg-brand-800 px-6 py-4 text-center text-white">
                {destacado.pacienteVisible ? (
                  <>
                    <p className="truncate text-[clamp(1.75rem,4.5vw,3.5rem)] font-black leading-tight">
                      {destacado.pacienteVisible}
                    </p>
                    <p className="truncate text-lg font-semibold text-brand-100">
                      {destacado.servicioNombre}
                      {destacado.profesionalNombre ? ` · ${destacado.profesionalNombre}` : ''}
                    </p>
                  </>
                ) : (
                  <p className="truncate text-[clamp(1.75rem,4.5vw,3.5rem)] font-black leading-tight">
                    {destacado.servicioNombre}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="grid min-h-0 flex-1 place-items-center rounded-lg bg-white">
              <p className="text-3xl font-bold text-slate-400">Esperando el proximo llamado...</p>
            </div>
          )}

          {enEspera > 0 ? (
            <p className="shrink-0 text-center text-sm font-bold uppercase tracking-wide text-slate-500">
              {enEspera} {enEspera === 1 ? 'llamado mas en cola' : 'llamados mas en cola'}
            </p>
          ) : null}
        </section>
      </div>

      {configuracion.mensajePie ? (
        <footer className="shrink-0 overflow-hidden whitespace-nowrap bg-brand-800 px-8 py-2.5 text-center text-lg font-bold text-white">
          {configuracion.mensajePie}
        </footer>
      ) : null}
    </main>
  )
}

'use client'

/**
 * Parametros generales de la pantalla y del llamado por audio
 * (requerimiento secciones 6.1 y 11).
 */

import { useEffect, useState } from 'react'
import { ArrowSquareOut, MonitorPlay, SpeakerHigh } from '@phosphor-icons/react/dist/ssr'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Loader'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Interruptor, Seleccion } from '@/components/admin/Campos'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import { sonarCampana } from '@/lib/turnos/anuncio'
import type { ConfiguracionSistema } from '@/lib/turnos/types'

export default function PantallaConfigClient() {
  const [configuracion, setConfiguracion] = useState<ConfiguracionSistema | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    pedir<{ configuracion: ConfiguracionSistema }>('/api/turnos/configuracion')
      .then((data) => setConfiguracion(data.configuracion))
      .catch((error) => toast.error('No se pudo cargar la configuracion', mensajeDeError(error)))
  }, [])

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!configuracion) return

    setGuardando(true)
    try {
      await pedir('/api/turnos/configuracion', { method: 'PUT', body: JSON.stringify(configuracion) })
      toast.success('Configuracion guardada', 'La pantalla toma los cambios en su proximo llamado.')
    } catch (error) {
      toast.error('No se pudo guardar', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  function cambiar<C extends keyof ConfiguracionSistema>(clave: C, valor: ConfiguracionSistema[C]) {
    setConfiguracion((previa) => (previa ? { ...previa, [clave]: valor } : previa))
  }

  /**
   * Cuantas consultas caben en una jornada, con la misma regla que usa el
   * servidor: la ultima tiene que terminar antes del cierre. Es solo una vista
   * previa para que el administrador vea el efecto de lo que esta cambiando
   * antes de guardar; la parrilla real la arma `horarioDelDia`.
   */
  function cuposDe(desde: string, hasta: string, duracion: number) {
    const minutos = (hora: string) => {
      const partes = /^(\d{1,2}):(\d{2})$/.exec(hora ?? '')
      return partes ? Number(partes[1]) * 60 + Number(partes[2]) : Number.NaN
    }

    const inicio = minutos(desde)
    const fin = minutos(hasta)
    if (!Number.isFinite(inicio) || !Number.isFinite(fin) || duracion < 1) return 0

    return Math.max(0, Math.floor((fin - inicio) / duracion))
  }

  if (!configuracion) {
    return (
      <div className="max-w-2xl space-y-6" aria-busy="true" aria-label="Cargando configuracion">
        {[3, 4, 1].map((campos, tarjeta) => (
          <Card key={tarjeta} padded={false}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-4">
              {Array.from({ length: campos }).map((_, campo) => (
                <div key={campo}>
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="mt-2 h-11 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const cuposManana = cuposDe(
    configuracion.jornadaMananaInicio,
    configuracion.jornadaMananaFin,
    configuracion.duracionCitaMinutos,
  )
  const cuposTarde = cuposDe(
    configuracion.jornadaTardeInicio,
    configuracion.jornadaTardeFin,
    configuracion.duracionCitaMinutos,
  )
  const cupos = cuposManana + cuposTarde

  return (
    <div className="max-w-2xl space-y-6">
      <Card padded={false}>
        <CardHeader>
          <CardTitle>Abrir la pantalla</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-6 text-slate-600">
            Abre esta direccion en el televisor de la sala de espera y pulsa &quot;Activar pantalla&quot;. Ese
            primer clic es obligatorio: los navegadores no dejan reproducir audio sin un gesto del usuario.
          </p>
          <p className="rounded-xl bg-slate-100 px-4 py-3 font-mono text-sm text-slate-700">/pantalla</p>
          <Link href="/pantalla" target="_blank" rel="noopener">
            <Button variant="secondary" size="sm">
              <MonitorPlay size={17} weight="bold" />
              Abrir en otra pestana
              <ArrowSquareOut size={15} />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <form onSubmit={guardar}>
        <Card padded={false}>
          <CardHeader>
            <CardTitle>Sonido del llamado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-black text-slate-800">Sonar en cada llamado</p>
                <p className="text-xs text-slate-500">
                  Si se apaga, la pantalla sigue mostrando los turnos pero en silencio.
                </p>
              </div>
              <Interruptor
                activo={configuracion.audioActivo}
                onChange={(valor) => cambiar('audioActivo', valor)}
                etiqueta="Sonar en cada llamado"
              />
            </div>

            <Campo etiqueta={`Volumen (${Math.round(configuracion.volumen * 100)}%)`}>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(configuracion.volumen * 100)}
                onChange={(e) => cambiar('volumen', Number(e.target.value) / 100)}
                disabled={!configuracion.audioActivo}
                className="h-11 w-full accent-brand-600"
                aria-label="Volumen del llamado"
              />
            </Campo>

            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => sonarCampana(configuracion.volumen)}
                disabled={!configuracion.audioActivo}
              >
                <SpeakerHigh size={17} weight="bold" />
                Probar sonido
              </Button>
            </div>

            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              Cada vez que un doctor o una ventanilla pasa al siguiente paciente suena una campanita corta,
              igual para todos. No se lee el turno en voz alta: la voz tardaba varios segundos por llamado y,
              cuando varios consultorios pasaban paciente casi al tiempo, el audio se quedaba atras de lo que
              ya mostraba la pantalla. El turno y el consultorio se leen en la pantalla, que es donde
              siempre estuvo la informacion completa.
            </div>
          </CardContent>
        </Card>

        <Card padded={false} className="mt-6">
          <CardHeader>
            <CardTitle>Pantalla</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/*
              Aqui habia un ajuste de "llamados recientes visibles", para una
              columna lateral que el rediseño de la pantalla quito: se podia
              cambiar y no hacia absolutamente nada. Un control que no mueve
              nada es peor que no tenerlo, porque el administrador cree haber
              configurado algo. El parametro sigue en el sistema por si esa
              lista vuelve; lo que se quita es la promesa falsa.
            */}
            <Campo etiqueta="Mensaje al pie" ayuda="Texto institucional que se muestra abajo. Dejalo vacio para ocultarlo.">
              <Entrada
                value={configuracion.mensajePie}
                onChange={(e) => cambiar('mensajePie', e.target.value)}
                maxLength={200}
                placeholder="Bienvenido a la ESE Hospital San Rafael de Chinu."
              />
            </Campo>
          </CardContent>
        </Card>

        <Card padded={false} className="mt-6">
          <CardHeader>
            <CardTitle>Agenda y horarios</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Campo
              etiqueta="Duracion de cada consulta"
              ayuda="Es el alto de cada franja del horario. De aqui sale cuantos pacientes caben por doctor."
            >
              <Seleccion
                value={String(configuracion.duracionCitaMinutos)}
                onChange={(e) => cambiar('duracionCitaMinutos', Number(e.target.value))}
                className="max-w-[220px]"
              >
                {[10, 15, 20, 30, 45, 60].map((minutos) => (
                  <option key={minutos} value={minutos}>
                    {minutos} minutos
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-600">
                Jornada de la mañana
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo etiqueta="Desde">
                  <Entrada
                    type="time"
                    value={configuracion.jornadaMananaInicio}
                    onChange={(e) => cambiar('jornadaMananaInicio', e.target.value)}
                  />
                </Campo>
                <Campo etiqueta="Hasta">
                  <Entrada
                    type="time"
                    value={configuracion.jornadaMananaFin}
                    onChange={(e) => cambiar('jornadaMananaFin', e.target.value)}
                  />
                </Campo>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-600">
                Jornada de la tarde
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo etiqueta="Desde">
                  <Entrada
                    type="time"
                    value={configuracion.jornadaTardeInicio}
                    onChange={(e) => cambiar('jornadaTardeInicio', e.target.value)}
                  />
                </Campo>
                <Campo etiqueta="Hasta">
                  <Entrada
                    type="time"
                    value={configuracion.jornadaTardeFin}
                    onChange={(e) => cambiar('jornadaTardeFin', e.target.value)}
                  />
                </Campo>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              {cupos > 0 ? (
                <>
                  Con esta configuracion, un doctor de jornada completa tiene{' '}
                  <strong className="font-black text-brand-800">{cupos} cupos</strong> al dia:{' '}
                  {cuposManana} en la mañana y {cuposTarde} en la tarde. Ese es el tope de citas por doctor;
                  no hay que fijarlo aparte, la ultima cita de cada jornada es la que alcanza a terminar
                  antes del cierre. En que jornada trabaja cada doctor se define en{' '}
                  <strong className="font-black">Profesionales</strong>.
                </>
              ) : (
                <span className="font-bold text-red-600">
                  Con estas horas no cabe ninguna consulta. Revisa que cada jornada termine despues de
                  empezar y que dure al menos lo que dura una consulta.
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="mt-5 flex justify-end">
          <Button type="submit" loading={guardando}>
            Guardar configuracion
          </Button>
        </div>
      </form>
    </div>
  )
}

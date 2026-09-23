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
import { franjasDeJornada } from '@/lib/turnos/tiempo'
import type { ConfiguracionGuardada, ConfiguracionSistema, DisenoPantalla } from '@/lib/turnos/types'

export default function PantallaConfigClient() {
  const [configuracion, setConfiguracion] = useState<ConfiguracionGuardada | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    pedir<{ configuracion: ConfiguracionGuardada }>('/api/turnos/configuracion')
      .then((data) => setConfiguracion(data.configuracion))
      .catch((error) => toast.error('No se pudo cargar la configuracion', mensajeDeError(error)))
  }, [])

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!configuracion) return

    setGuardando(true)
    try {
      // La respuesta trae la configuracion recien guardada, con su marca nueva:
      // se adopta para que el siguiente guardado de esta misma pantalla no
      // parezca el de alguien que trabaja sobre una version vieja.
      const guardada = await pedir<{ configuracion: ConfiguracionGuardada }>(
        '/api/turnos/configuracion',
        { method: 'PUT', body: JSON.stringify(configuracion) },
      )
      setConfiguracion(guardada.configuracion)
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
   * Cuantas consultas caben en una jornada.
   *
   * LO CUENTA LA REGLA DEL DOMINIO, no una copia. Esta cuenta estaba rehecha a
   * mano aqui, y el dia que cambiara la regla del servidor esta pantalla —justo
   * donde el administrador decide el horario del hospital— le habria dicho "20
   * cupos al dia" mientras la agenda real abria otros. `franjasDeJornada` es
   * pura, asi que se puede llamar igual desde el navegador.
   */
  function cuposDe(desde: string, hasta: string, duracion: number) {
    return franjasDeJornada(desde, hasta, duracion).length
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
            Abre esta direccion en el televisor de la sala de espera: los turnos se ven solos. Si aparece
            &quot;Sonido desactivado: toca para activar&quot;, toca el aviso; con el modo kiosco del televisor no
            hace falta.
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
                <p className="text-sm font-semibold text-slate-800">Sonar en cada llamado</p>
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
            {/*
              EL ASPECTO DEL TELEVISOR, con las dos opciones descritas por lo
              que el paciente ve, no por su nombre tecnico: quien elige aqui no
              tiene por que saber que es una "cuadricula" hasta que se lo
              cuentan. El cambio alcanza a TODAS las salas en cuanto se guarda,
              y eso se avisa, porque desde esta pantalla no se ve ninguna.
            */}
            <Campo
              etiqueta="Diseño de la pantalla"
              ayuda="Aplica a todos los televisores del hospital en cuanto guardes."
            >
              <Seleccion
                value={configuracion.disenoPantalla}
                onChange={(e) => cambiar('disenoPantalla', e.target.value as DisenoPantalla)}
              >
                <option value="CUADRICULA">
                  Cuadricula — una casilla por consultorio, todas visibles a la vez
                </option>
                <option value="CARTELERA">
                  Cartelera — el turno en curso en grande, con los anteriores debajo
                </option>
              </Seleccion>
            </Campo>

            {/*
              La imagen solo se ofrece con la cartelera, que es la unica que la
              usa. Mostrarla siempre invitaria a configurar un fondo que no se
              ve en ninguna parte, y despues a buscar por que no aparece.
            */}
            {configuracion.disenoPantalla === 'CARTELERA' ? (
              <Campo
                etiqueta="Imagen de fondo"
                ayuda="Ruta de una imagen de este mismo sitio, por ejemplo /img/fondo-sala.jpg. Copia el archivo en la carpeta public/img del servidor. Dejalo vacio para un fondo liso."
              >
                <Entrada
                  value={configuracion.fondoPantalla}
                  onChange={(e) => cambiar('fondoPantalla', e.target.value)}
                  maxLength={200}
                  placeholder="/img/fondo-sala.jpg"
                />
              </Campo>
            ) : null}

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
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">
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
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">
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
                  <strong className="font-semibold text-brand-800">{cupos} cupos</strong> al dia:{' '}
                  {cuposManana} en la mañana y {cuposTarde} en la tarde. Ese es el tope de citas por doctor;
                  no hay que fijarlo aparte, la ultima cita de cada jornada es la que alcanza a terminar
                  antes del cierre. En que jornada trabaja cada doctor se define en{' '}
                  <strong className="font-semibold">Profesionales</strong>.
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

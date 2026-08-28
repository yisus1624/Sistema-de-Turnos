'use client'

/**
 * Parametros generales de la pantalla y del llamado por audio
 * (requerimiento secciones 6.1 y 11).
 */

import { useEffect, useState } from 'react'
import { ArrowSquareOut, MonitorPlay } from '@phosphor-icons/react/dist/ssr'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Interruptor, Seleccion } from '@/components/admin/Campos'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import type { ConfiguracionPantalla } from '@/lib/turnos/types'

export default function PantallaConfigClient() {
  const [configuracion, setConfiguracion] = useState<ConfiguracionPantalla | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    pedir<{ configuracion: ConfiguracionPantalla }>('/api/turnos/configuracion')
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

  function cambiar<C extends keyof ConfiguracionPantalla>(clave: C, valor: ConfiguracionPantalla[C]) {
    setConfiguracion((previa) => (previa ? { ...previa, [clave]: valor } : previa))
  }

  if (!configuracion) {
    return <p className="py-10 text-center text-sm text-slate-500">Cargando configuracion...</p>
  }

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
            <CardTitle>Llamado por audio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-black text-slate-800">Anunciar por voz</p>
                <p className="text-xs text-slate-500">
                  Si se apaga, la pantalla sigue mostrando los turnos pero en silencio.
                </p>
              </div>
              <Interruptor
                activo={configuracion.audioActivo}
                onChange={(valor) => cambiar('audioActivo', valor)}
                etiqueta="Anunciar por voz"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Repeticiones" ayuda="Cuantas veces se repite cada anuncio.">
                <Seleccion
                  value={String(configuracion.repeticionesAudio)}
                  onChange={(e) => cambiar('repeticionesAudio', Number(e.target.value))}
                  disabled={!configuracion.audioActivo}
                >
                  <option value="1">Una vez</option>
                  <option value="2">Dos veces</option>
                  <option value="3">Tres veces</option>
                </Seleccion>
              </Campo>

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
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              <strong className="font-black">Sobre la voz:</strong> la pantalla usa las voces instaladas en el
              computador del televisor y prefiere siempre la de español de Colombia. Si ese equipo no tiene
              ninguna voz en español, el llamado sale sin audio en lugar de leerse con acento extranjero. Para
              conseguir una voz colombiana natural, abre la pantalla en Microsoft Edge o instala la voz de
              español (Colombia) desde Configuracion de Windows.
            </div>
          </CardContent>
        </Card>

        <Card padded={false} className="mt-6">
          <CardHeader>
            <CardTitle>Pantalla</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Campo etiqueta="Llamados recientes visibles" ayuda="Cuantos turnos se listan en la columna izquierda.">
              <Seleccion
                value={String(configuracion.ultimosVisibles)}
                onChange={(e) => cambiar('ultimosVisibles', Number(e.target.value))}
              >
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Seleccion>
            </Campo>

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

        <div className="mt-5 flex justify-end">
          <Button type="submit" loading={guardando}>
            Guardar configuracion
          </Button>
        </div>
      </form>
    </div>
  )
}

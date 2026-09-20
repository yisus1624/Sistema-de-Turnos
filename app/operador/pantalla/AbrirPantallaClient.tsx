'use client'

/**
 * Un boton y nada mas: abrir la pantalla de la sala de espera.
 *
 * El unico aviso que se deja es el del primer clic dentro del televisor, y no
 * por adorno: los navegadores no dejan sonar audio sin un gesto de una
 * persona, asi que sin ese clic la pantalla se ve pero los llamados quedan
 * mudos, y es el fallo que mas se repite al montarla.
 */

import Link from 'next/link'
import { ArrowSquareOut, MonitorPlay } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'

export default function AbrirPantallaClient() {
  return (
    <div className="mx-auto max-w-md py-6 text-center">
      <Link href="/pantalla" target="_blank" rel="noopener">
        <Button size="lg">
          <MonitorPlay size={20} weight="bold" />
          Abrir la pantalla
          <ArrowSquareOut size={16} />
        </Button>
      </Link>

      <p className="mt-4 text-sm leading-6 text-slate-500">
        Se abre en otra pestana. Alli hay que pulsar una vez{' '}
        <strong className="font-semibold text-slate-600">Activar pantalla</strong>: sin ese clic el
        televisor no puede reproducir el sonido de los llamados.
      </p>
    </div>
  )
}

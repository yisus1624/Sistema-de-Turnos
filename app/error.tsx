'use client'

/**
 * Limite de errores de todas las pantallas internas (Reportes, Agenda,
 * Historico...).
 *
 * Sin el, una excepcion al dibujar dejaba "Application error" en blanco y
 * nada la recuperaba: habia que saber recargar a mano. Aqui se explica que
 * paso y se ofrece reintentar, que vuelve a pedir la pantalla al servidor y
 * la monta de cero (con los filtros de siempre, no con el dato que la rompio).
 *
 * El televisor y el consultorio tienen el suyo, que ademas se recupera solo.
 */
import Link from 'next/link'
import type { ErrorInfo } from 'next/error'
import { Button } from '@/components/ui/Button'
import PantallaDeError from '@/components/ui/PantallaDeError'

export default function ErrorDeLaPantalla({ retry }: ErrorInfo) {
  return (
    <PantallaDeError
      titulo="No se pudo mostrar esta pantalla"
      descripcion="Ocurrió un error inesperado al mostrarla. Pulsa Reintentar; si vuelve a pasar, avisa a la oficina de sistemas del hospital."
    >
      <Button type="button" onClick={retry}>
        Reintentar
      </Button>
      <Link href="/" className="text-sm font-semibold text-acento-700 underline-offset-4 hover:underline">
        Volver al inicio
      </Link>
    </PantallaDeError>
  )
}

'use client'

/**
 * Ultimo limite de errores: el de la propia raiz (`app/layout.tsx`).
 *
 * Cuando se activa REEMPLAZA al layout raiz, asi que tiene que traer su propio
 * `<html>` y `<body>`, y los estilos y la fuente que en las demas pantallas
 * pone ese layout (Next no los incluye aqui). Por la misma razon el titulo va
 * con `<title>`: este archivo no admite `metadata`.
 *
 * "Volver al inicio" es un enlace normal, que recarga la pagina entera: si lo
 * que se rompio fue la raiz, la navegacion interna puede estar rota con ella.
 */
import './globals.css'
import { GeistSans } from 'geist/font/sans'
import type { ErrorInfo } from 'next/error'
import { Button } from '@/components/ui/Button'
import PantallaDeError from '@/components/ui/PantallaDeError'

export default function ErrorGlobal({ retry }: ErrorInfo) {
  return (
    <html lang="es">
      <body className={GeistSans.className}>
        <title>Algo salió mal | Sistema de Turnos</title>
        <PantallaDeError
          titulo="El sistema de turnos no pudo cargarse"
          descripcion="Ocurrió un error inesperado. Pulsa Reintentar; si vuelve a pasar, avisa a la oficina de sistemas del hospital."
        >
          <Button type="button" onClick={retry}>
            Reintentar
          </Button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- recarga entera a proposito, ver arriba */}
          <a href="/" className="text-sm font-semibold text-acento-700 underline-offset-4 hover:underline">
            Volver al inicio
          </a>
        </PantallaDeError>
      </body>
    </html>
  )
}

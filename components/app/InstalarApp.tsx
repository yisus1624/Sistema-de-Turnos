'use client'

/**
 * La app instalable: solo registra el service worker.
 *
 * NO HAY BOTON PROPIO DE "INSTALAR" (decision del hospital): lo ofrece el
 * navegador, con el icono de instalar en la barra de direcciones de Chrome y
 * Edge, o "Agregar a pantalla de inicio" en el celular. Para eso basta el
 * manifiesto (`app/manifest.ts`) y este service worker.
 */
import { useEffect } from 'react'

/** Registra el service worker una vez por carga. */
export function RegistrarApp() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sin service worker la app funciona igual; solo no se puede instalar.
    })
  }, [])
  return null
}

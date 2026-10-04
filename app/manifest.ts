import type { MetadataRoute } from 'next'

/**
 * La app instalable ("Agregar a pantalla de inicio" / "Instalar").
 *
 * UNA SOLA APP para todos: administrador, operador y medicos. Arranca en `/`,
 * que lleva a cada quien a lo suyo: con sesion, a su pantalla de trabajo; en
 * un equipo autorizado para medicos, a la entrada con PIN (`/medico`); y si
 * no, al inicio de sesion. Asi en el computador del consultorio basta tocar el
 * icono y escribir el PIN, sin escribir nunca una direccion.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Turnos · ESE Hospital San Rafael de Chinu',
    short_name: 'Turnos',
    description: 'Sistema de turnos de la ESE Hospital San Rafael de Chinu.',
    lang: 'es',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#0a2634',
    icons: [
      { src: '/icons/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icono-adaptable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

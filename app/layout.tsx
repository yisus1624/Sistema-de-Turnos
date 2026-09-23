import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import './globals.css'
import 'sileo/styles.css'
import { Toaster } from 'sileo'

const appUrl =
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.NEXTAUTH_URL ??
  'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  applicationName: 'Sistema de Turnos',
  title: {
    default: 'Sistema de Turnos | ESE Hospital San Rafael de Chinu',
    template: '%s | Sistema de Turnos',
  },
  description:
    'Gestion, llamado y visualizacion de turnos de atencion al usuario de la ESE Hospital San Rafael de Chinu.',
  authors: [{ name: 'ESE Hospital San Rafael de Chinu' }],
  manifest: '/manifest.webmanifest',
  alternates: { canonical: '/' },
  appleWebApp: {
    capable: true,
    title: 'Turnos',
    statusBarStyle: 'black-translucent',
  },
  // Sistema interno del hospital: nunca debe indexarse.
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: '#0a2634',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={GeistSans.className}>
        {/*
          Sin SessionProvider a proposito: ninguna pantalla usa `useSession` (la
          sesion se lee en el servidor), y el proveedor pedia /api/auth/session
          al cargar cada pagina y cada vez que una pestaña volvia a primer plano.
          Con todo el hospital detras de una sola IP, esas peticiones se comian
          el cupo de nginx que necesitaban los inicios de sesion de verdad.
        */}
        {children}
        <Toaster position="top-right" offset={{ top: 18, right: 18, bottom: 88 }} />
      </body>
    </html>
  )
}

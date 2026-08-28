const path = require('node:path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  poweredByHeader: false,
  turbopack: {
    root: path.join(__dirname),
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
      {
        // La pantalla de sala de espera se puede embeber (ej. dentro del
        // panel de pruebas del administrador), pero solo desde el mismo
        // sitio: no se abre la puerta a que cualquier pagina externa la
        // enmarque (eso seguiria bloqueado por la regla DENY de arriba en
        // todas las demas rutas).
        source: '/pantalla',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
    ]
  },
}
module.exports = nextConfig

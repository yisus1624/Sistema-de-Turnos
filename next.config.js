const path = require('node:path')

/**
 * HSTS: le dice al navegador "de aqui en adelante, a este servidor entra SIEMPRE
 * por HTTPS". Protege de que alguien en la red del hospital intercepte la
 * conexion, y de que un enlace viejo en http:// mande las contrasenas en claro.
 *
 * APAGADO POR DEFECTO, y se enciende con TURNOS_HSTS=1. No es una decision que
 * se pueda tomar sola: en cuanto un navegador recibe esta cabecera, se niega a
 * entrar por http a ese servidor durante `max-age`, y NO hay forma de
 * desdecirlo desde el servidor —hay que ir maquina por maquina a limpiarlo—.
 * Si se enciende antes de tener el certificado funcionando, el hospital se
 * queda sin acceso al sistema.
 *
 * El orden correcto es: montar HTTPS, comprobar que entran todos (incluido el
 * televisor de la sala de espera) y SOLO ENTONCES poner TURNOS_HSTS=1.
 *
 * OJO, ESTA VARIABLE SE LEE AL COMPILAR, NO AL ARRANCAR. Las cabeceras de aqui
 * quedan grabadas en el build, asi que ponerla y reiniciar el servidor no hace
 * absolutamente nada: hay que volver a ejecutar `npm run build`. Como eso es un
 * fallo que no se ve —uno cree que activo HTTPS obligatorio y no—, el valor con
 * el que se compilo se expone abajo y `instrumentation.ts` avisa por consola si
 * al arrancar no coincide.
 *
 * Un ano de vigencia, incluyendo subdominios: es el valor habitual una vez que
 * el certificado ya esta en su sitio.
 */
const hstsActivo = process.env.TURNOS_HSTS === '1'

const cabecerasHsts = hstsActivo
  ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
  : []

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  poweredByHeader: false,
  // Con que valor se compilaron las cabeceras. Lo lee `instrumentation.ts` para
  // avisar si al arrancar la variable dice otra cosa (ver arriba).
  env: { TURNOS_HSTS_COMPILADO: hstsActivo ? '1' : '0' },
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
          ...cabecerasHsts,
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

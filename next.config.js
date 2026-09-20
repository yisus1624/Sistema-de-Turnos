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

/**
 * Content-Security-Policy: que puede cargar y ejecutar el navegador.
 *
 * Es la red que queda si algun dia entra contenido ajeno en una pantalla (un
 * nombre de doctor o un mensaje al pie con un <script> dentro, un reporte de
 * citas manipulado): sin esto, ese script puede leer la sesion del funcionario
 * y hablar con cualquier servidor de internet; con esto, el navegador se niega
 * a cargar nada que no venga de este mismo servidor.
 *
 * QUE SE RELAJO, Y POR QUE. Dos directivas no pueden ser estrictas hoy:
 *
 * - `script-src 'unsafe-inline'`: Next.js inyecta en cada pagina sus propios
 *   scripts EN LINEA (el arranque de React y los datos del servidor). La forma
 *   limpia de permitirlos sin abrir la puerta a todos es firmarlos con un
 *   nonce distinto por peticion, y eso exige un middleware que reescriba la
 *   cabecera en cada respuesta: estas cabeceras se graban AL COMPILAR y no
 *   pueden llevar un valor que cambie por peticion. Sin `unsafe-inline` la
 *   aplicacion entera se queda en blanco, televisor de la sala de espera
 *   incluido. Se deja abierto y se anota como pendiente.
 *
 * - `style-src 'unsafe-inline'`: lo mismo con los estilos en linea, que usan
 *   tanto Next como la fuente Geist.
 *
 * Lo demas si va cerrado: nada de este sistema carga scripts, tipografias ni
 * datos de otros dominios (no hay CDN, ni analitica, ni mapas), asi que
 * `'self'` alcanza para todo.
 *
 * `'unsafe-eval'` SOLO EN DESARROLLO: lo necesitan las herramientas de recarga
 * en caliente. En el servidor del hospital no se envia.
 *
 * EL ENMARCADO NO SE CONTROLA AQUI. Se queda en `X-Frame-Options`, que ya
 * distingue el caso de `/pantalla` (ver abajo). Si se pusiera
 * `frame-ancestors` en esta politica global, la pantalla recibiria dos CSP y
 * el navegador aplica la MAS restrictiva de las dos: el televisor embebido en
 * el panel del administrador dejaria de verse.
 *
 * TAMPOCO VA `upgrade-insecure-requests`: el sistema puede estar todavia sin
 * HTTPS delante (ver docs/despliegue.md), y forzar la subida ahi deja las
 * peticiones sin respuesta.
 */
const enDesarrollo = process.env.NODE_ENV !== 'production'

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${enDesarrollo ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // `data:` para los iconos embebidos; `blob:` para lo que genera el propio
  // navegador (la vista previa de un PDF antes de descargarlo).
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Aqui entra el canal en vivo (SSE) y todas las llamadas a la API: mismo
  // origen y nada mas.
  "connect-src 'self'",
  // El aviso de la sala de espera es una campanita que se sintetiza en el
  // propio navegador (ver lib/turnos/anuncio.ts): no carga ningun archivo de
  // audio, pero `blob:` cubre el PDF que se abre para imprimir.
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

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
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          ...cabecerasHsts,
        ],
      },
      {
        /*
          EL CONSULTORIO NO MANDA REFERER A NADIE.

          La politica general, `strict-origin-when-cross-origin`, envia la URL
          COMPLETA en las peticiones del mismo origen. Mientras la pagina del
          doctor vivio en `/consultorio/<token>`, eso significaba que cada
          `fetch` a la API y cada reconexion del canal de eventos salia con
          `Referer: https://host/consultorio/<TOKEN>` —y el referer si acaba en
          los registros del proxy—.

          El token ya no esta en la direccion de la pagina (lo canjea el
          middleware por una cookie), asi que esta regla es la segunda linea:
          cubre el instante de la PRIMERA visita, cuando la pagina todavia se
          esta sirviendo desde la URL que si lo lleva, y cualquier recurso que
          esa pagina llegue a pedir antes de la redireccion.
        */
        source: '/consultorio/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
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

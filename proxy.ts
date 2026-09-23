/**
 * El enlace del doctor entra una vez y el token desaparece de la vista.
 *
 * POR QUE EXISTE ESTE ARCHIVO. El doctor recibe `/consultorio/<token>`: es un
 * enlace magico y el token tiene que ir ahi, no hay otra forma de mandarselo
 * por WhatsApp. El problema era lo que pasaba DESPUES: la pagina se quedaba en
 * esa direccion y cada llamada a la API repetia el token en la ruta, de modo
 * que nginx lo escribia en claro en su `access.log` decenas de veces por
 * jornada (registra `$request` entero por defecto). Quien leyera esos logs se
 * llevaba una llave que abre la agenda con nombres y documentos de pacientes
 * sin pedir contrasena.
 *
 * Aqui el token se cambia por una cookie en el primer contacto y se redirige a
 * `/consultorio`, sin token. A partir de ese instante:
 *
 *   - La barra de direcciones ya no lo muestra (ni al doctor ni a quien pase
 *     por detras, ni en una captura de pantalla).
 *   - Ninguna peticion posterior lo lleva en la ruta: viaja en la cookie, que
 *     no aparece en el registro de peticiones.
 *   - El `Referer` de la pagina es `/consultorio`, asi que tampoco se filtra
 *     por esa via (y ademas `next.config.js` le pone `no-referrer`).
 *   - El JavaScript de la pagina NO puede leerlo: la cookie es `HttpOnly`.
 *
 * Queda una sola linea con el token en el registro, la de la primera visita.
 * Es inevitable en un enlace magico; lo que se elimina son las otras cientos.
 *
 * AQUI NO SE VALIDA EL TOKEN, y es a proposito: esto corre en el runtime de
 * borde, sin acceso a la base de datos. La validacion sigue donde siempre, en
 * cada ruta de la API (`requireProfesionalDelConsultorio`), que es lo unico que
 * de verdad protege. Esto solo mueve el token de sitio.
 *
 * SE LLAMA `proxy.ts` Y NO `middleware.ts` porque es el convenio de Next 16;
 * el anterior sigue funcionando pero avisa de que esta descontinuado.
 */
import { NextResponse, type NextRequest } from 'next/server'

/** El mismo nombre que leen las rutas (ver `lib/turnos/acceso-consultorio.ts`). */
const COOKIE_CONSULTORIO = 'turnos_consultorio'

/**
 * Tope de vida de la cookie: las 72 horas del enlace mas largo que el sistema
 * permite generar. No es un permiso —cada peticion revalida el token contra la
 * base y un enlace revocado deja de servir en el acto— sino la garantia de que
 * el navegador no se queda guardando una llave muerta para siempre.
 */
const MAX_EDAD_COOKIE = 72 * 60 * 60

/**
 * El token del enlace, o null si no se puede leer.
 *
 * Un "%" mal escrito (el enlace copiado a medias de un chat) hacia fallar
 * `decodeURIComponent` con un 500: el doctor veia un error del servidor en vez
 * del aviso de enlace no valido.
 */
function tokenDelEnlace(ruta: string): string | null {
  try {
    return decodeURIComponent(ruta.slice('/consultorio/'.length))
  } catch {
    return null
  }
}

export default function proxy(request: NextRequest) {
  const enRuta = request.nextUrl.pathname.slice('/consultorio/'.length)

  // Sin token no hay nada que canjear. Se deja pasar: si ya tiene cookie, la
  // pantalla funciona; si no, la API respondera 401 con su mensaje.
  if (!enRuta) return NextResponse.next()

  const destino = new URL('/consultorio', request.url)
  const respuesta = NextResponse.redirect(destino)

  // Ilegible: se saca de la barra de direcciones igual y se BORRA la cookie
  // que hubiera, para que la pantalla diga que el enlace no es valido en vez
  // de seguir entrando con el enlace de antes (quiza de otro doctor).
  const token = tokenDelEnlace(request.nextUrl.pathname)
  if (!token) {
    respuesta.cookies.set(COOKIE_CONSULTORIO, '', { path: '/api/consultorio', maxAge: 0 })
    return respuesta
  }

  respuesta.cookies.set(COOKIE_CONSULTORIO, token, {
    httpOnly: true,
    // En desarrollo se entra por http, donde una cookie `Secure` no se guarda
    // y el doctor no podria entrar nunca.
    secure: process.env.NODE_ENV === 'production',
    // `strict` y no `lax`: nada de lo que hace esta pantalla se inicia desde
    // otro sitio, asi que no hay razon para que la cookie viaje en una
    // peticion que venga de fuera.
    sameSite: 'strict',
    // Acotada a las rutas del consultorio: asi no acompaña a las peticiones de
    // la pantalla publica ni a las del resto del sistema.
    path: '/api/consultorio',
    maxAge: MAX_EDAD_COOKIE,
  })

  return respuesta
}

export const config = {
  /*
    Solo el canje del enlace. Deliberadamente estrecho: un middleware que corra
    en todas las peticiones se cobra latencia en cada pagina del sistema y se
    convierte en un sitio donde se acumula logica que no le corresponde.
  */
  matcher: ['/consultorio/:token'],
}

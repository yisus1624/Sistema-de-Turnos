/**
 * Revision de la configuracion al arrancar el servidor.
 *
 * Next llama a `register()` una sola vez, al levantar el proceso. Lo que se
 * comprueba aqui son los descuidos de despliegue que NO SE VEN: el sistema
 * arranca, la pantalla pinta turnos, todo parece correcto, y resulta que sigue
 * con la contrasena de administrador que esta escrita en el codigo, o que el
 * HTTPS obligatorio que alguien creyo activar no se activo.
 *
 * En un hospital eso no se puede quedar callado. Ninguna de estas
 * comprobaciones tumba el arranque salvo la del secreto de sesion, que sin el
 * no hay sesiones que valgan: las demas avisan por la consola del servidor, que
 * es donde mira quien despliega.
 *
 * Todas las variables estan documentadas en `.env.example`.
 */

const ROJO = '\x1b[31m'
const AMARILLO = '\x1b[33m'
const FIN = '\x1b[0m'

function grave(mensaje: string) {
  console.error(`${ROJO}[configuracion] ${mensaje}${FIN}`)
}

function aviso(mensaje: string) {
  console.warn(`${AMARILLO}[configuracion] ${mensaje}${FIN}`)
}

export async function register() {
  // Solo en el servidor de Node: el runtime edge no despliega nada.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const produccion = process.env.NODE_ENV === 'production'

  if (!process.env.NEXTAUTH_SECRET) {
    grave(
      'Falta NEXTAUTH_SECRET: sin el no se pueden firmar las sesiones y nadie podra entrar. ' +
        'Generar una con "openssl rand -base64 32" y ponerla en .env.local.',
    )
  }

  // Las cuentas semilla existen para desarrollar sin la fuente real del
  // hospital, y sus contrasenas por defecto estan escritas en el codigo (por
  // tanto, son publicas). Dejarlas en un servidor de la red del hospital es
  // entregarle el administrador a cualquiera que haya visto el repositorio.
  if (produccion) {
    if (!process.env.TURNOS_ADMIN_PASSWORD) {
      grave(
        'El administrador esta usando la contrasena por defecto, que esta escrita en el codigo y es publica. ' +
          'Definir TURNOS_ADMIN_PASSWORD antes de poner el sistema en la red.',
      )
    }
    if (!process.env.TURNOS_OPERADOR_PASSWORD) {
      grave(
        'El operador esta usando la contrasena por defecto, que esta escrita en el codigo y es publica. ' +
          'Definir TURNOS_OPERADOR_PASSWORD antes de poner el sistema en la red.',
      )
    }

    // Este panel borra las citas y los turnos del dia de un clic.
    if (process.env.TURNOS_SIMULACION === '1') {
      aviso(
        'TURNOS_SIMULACION=1: el panel de simulacion esta habilitado y BORRA las citas y los turnos del dia. ' +
          'Quitarla en el servidor de produccion.',
      )
    }
  }

  // Las cabeceras se graban al compilar (ver next.config.js). Si aqui la
  // variable dice una cosa y el build otra, alguien la puso sin volver a
  // compilar y esta creyendo que tiene una proteccion que no tiene.
  const hstsPedido = process.env.TURNOS_HSTS === '1'
  const hstsCompilado = process.env.TURNOS_HSTS_COMPILADO === '1'
  if (hstsPedido !== hstsCompilado) {
    aviso(
      hstsPedido
        ? 'TURNOS_HSTS=1 pero el build se hizo sin ella, asi que la cabecera Strict-Transport-Security NO se esta enviando. ' +
            'Volver a ejecutar "npm run build" con la variable puesta.'
        : 'El build se hizo con TURNOS_HSTS=1 y ahora la variable no esta: se sigue enviando Strict-Transport-Security. ' +
            'Volver a compilar si se queria desactivar.',
    )
  }

  if (produccion && process.env.TURNOS_CONFIAR_PROXY !== '1') {
    aviso(
      'Sin TURNOS_CONFIAR_PROXY=1 no se confia en la IP del cliente, asi que el limite de intentos de entrada por IP ' +
        'queda desactivado (el limite por usuario sigue activo). Ponerla solo si hay un proxy inverso delante.',
    )
  }
}

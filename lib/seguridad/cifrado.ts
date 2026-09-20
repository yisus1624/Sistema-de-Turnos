import 'server-only'

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Cifrado simetrico para secretos que el servidor necesita PODER LEER.
 *
 * POR QUE EXISTE, SI LO NORMAL ES GUARDAR SOLO EL HASH. Un hash es lo correcto
 * para lo que solo hay que COMPROBAR: la contrasena de un usuario se compara,
 * no se lee. Pero el enlace de consultorio hay que poder volver a ENSEÑARLO
 * mientras dura el turno del doctor: en el mostrador se pierde el mensaje, o lo
 * genero otro equipo, y la unica alternativa era generar uno nuevo —lo que
 * expulsa al doctor que en ese momento esta llamando pacientes—. Un hash no se
 * puede deshacer, asi que para eso hace falta cifrado, no hash.
 *
 * EL HASH NO SE VA. El `tokenHash` sigue siendo lo que valida la entrada al
 * consultorio; esto es una copia aparte, cifrada, que existe SOLO mientras el
 * enlace esta vigente y se borra en cuanto vence o se revoca. Asi, el contenido
 * descifrable de la tabla en cualquier momento son unos pocos enlaces que de
 * todas formas caducan solos en horas.
 *
 * AES-256-GCM: cifra y ademas autentica. Si alguien toca el texto cifrado en la
 * base de datos, el descifrado falla en vez de devolver basura.
 */

const ALGORITMO = 'aes-256-gcm'
const BYTES_IV = 12
const BYTES_ETIQUETA = 16

/**
 * La clave, derivada del secreto del entorno.
 *
 * Se prefiere una variable propia (`TURNOS_CLAVE_SECRETOS`) para poder rotarla
 * sin tocar las sesiones, y si no existe se cae al secreto de autenticacion,
 * que en este proyecto siempre esta configurado. Se pasa por SHA-256 porque el
 * algoritmo pide exactamente 32 bytes y un secreto escrito a mano no los mide.
 */
function clave(): Buffer {
  const secreto = process.env.TURNOS_CLAVE_SECRETOS || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secreto) {
    throw new Error(
      'Falta TURNOS_CLAVE_SECRETOS (o AUTH_SECRET) para cifrar los enlaces de consultorio.',
    )
  }
  return createHash('sha256').update(secreto).digest()
}

/**
 * Cifra un texto. El resultado lleva dentro el vector de inicializacion y la
 * etiqueta de autenticacion, asi que es lo unico que hay que guardar.
 *
 * El IV es nuevo en cada llamada: reutilizarlo en GCM rompe el cifrado por
 * completo, no solo lo debilita.
 */
export function cifrar(texto: string): string {
  const iv = randomBytes(BYTES_IV)
  const cifrador = createCipheriv(ALGORITMO, clave(), iv)
  const cuerpo = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()])
  return Buffer.concat([iv, cifrador.getAuthTag(), cuerpo]).toString('base64')
}

/**
 * Cifra, y si no se puede devuelve `null` en vez de lanzar.
 *
 * Para lo que es una COMODIDAD y no una funcion. Guardar la copia recuperable
 * del enlace de consultorio es un lujo; generar el enlace es el trabajo. Con
 * `cifrar` a secas, un despliegue sin el secreto en el entorno dejaba a todo el
 * hospital sin poder generar enlaces, cuando lo unico que de verdad hacia falta
 * —el hash que valida la entrada— no depende de esto para nada.
 *
 * El fallo se avisa por consola: quedarse sin copia recuperable es una
 * degradacion silenciosa, y alguien tiene que poder enterarse de por que el
 * ojito dejo de funcionar en toda la instalacion.
 */
export function cifrarSiSePuede(texto: string): string | null {
  try {
    return cifrar(texto)
  } catch (error) {
    console.error(
      'No se pudo cifrar el secreto: se guarda sin copia recuperable. Revisa TURNOS_CLAVE_SECRETOS.',
      error,
    )
    return null
  }
}

/**
 * Descifra lo que produjo `cifrar`.
 *
 * Devuelve `null` en vez de lanzar cuando el texto no se puede descifrar: pasa
 * si se rota el secreto con enlaces todavia vivos, y ahi lo correcto es que la
 * pantalla diga "no se puede mostrar, genera otro" y no que reviente.
 */
export function descifrar(guardado: string): string | null {
  try {
    const crudo = Buffer.from(guardado, 'base64')
    const iv = crudo.subarray(0, BYTES_IV)
    const etiqueta = crudo.subarray(BYTES_IV, BYTES_IV + BYTES_ETIQUETA)
    const cuerpo = crudo.subarray(BYTES_IV + BYTES_ETIQUETA)

    const descifrador = createDecipheriv(ALGORITMO, clave(), iv)
    descifrador.setAuthTag(etiqueta)
    return Buffer.concat([descifrador.update(cuerpo), descifrador.final()]).toString('utf8')
  } catch {
    return null
  }
}

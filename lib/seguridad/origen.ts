/**
 * De que IP viene una peticion, detras del proxy.
 *
 * Sin dependencias de Next, para poder probarla y reutilizarla. La usa
 * `contextoPeticion` (registro de actividad y limites por origen).
 *
 * NO HAY LISTA DE IPS DE CONFIANZA, A PROPOSITO. Todo el hospital sale a
 * internet por una IP que el proveedor cambia cuando quiere: pedirla y
 * mantenerla configurada es fragil y no tiene sentido. En su lugar, los topes
 * por IP son lo bastante altos para que una oficina entera no los alcance, y la
 * proteccion fina va por cuenta, por enlace y por sesion.
 */

/**
 * La IP del cliente segun las cabeceras que escribe el proxy.
 *
 * Se toma la ULTIMA de `X-Forwarded-For`, no la primera: la ultima la pone
 * siempre el proxy mas cercano, que es el nuestro. La primera la puede escribir
 * el cliente, y con un nginx configurado con `$proxy_add_x_forwarded_for` (que
 * ANADE en vez de sobrescribir) bastaba con mandar la cabecera a mano para
 * inventarse una IP, saltarse los limites y falsear el registro de actividad.
 * Con la configuracion recomendada (sobrescribir) hay una sola, y da igual.
 */
export function ipReenviadaPorElProxy(reenviado: string | null, real: string | null): string | null {
  const ultima = reenviado?.split(',').at(-1)?.trim()
  return ultima || real?.trim() || null
}

/**
 * Que cambio de verdad en una edicion, con el antes y el despues.
 *
 * Existe porque varios eventos del registro apuntaban `Object.keys(datos)`, y
 * eso no sirve para auditar: las pantallas mandan el objeto ENTERO cada vez que
 * se pulsa guardar, asi que el apunte listaba todos los campos aunque no se
 * hubiera tocado ninguno, y sin los valores no habia forma de deshacer a mano
 * lo que salio mal.
 *
 * Solo se comparan las claves que llegaron: las que el cliente no mando no se
 * tocaron, y sacarlas como "sin cambio" solo alarga el detalle.
 */

export interface CambioDeCampo {
  antes: unknown
  despues: unknown
}

export function camposCambiados<T extends object>(
  antes: T,
  despues: Partial<T>,
): Record<string, CambioDeCampo> {
  // El antes se recorre como mapa para leerlo por clave sin forzar el tipo:
  // los objetos que llegan aqui son fichas con forma propia, no diccionarios.
  const anteriores = new Map<string, unknown>(Object.entries(antes))
  const cambios: Record<string, CambioDeCampo> = {}

  for (const [campo, valor] of Object.entries(despues)) {
    const previo = anteriores.get(campo)
    if (esIgual(previo, valor)) continue
    cambios[campo] = { antes: previo ?? null, despues: valor ?? null }
  }

  return cambios
}

/**
 * Comparacion por contenido.
 *
 * Los valores del registro son datos planos (textos, numeros, listas de
 * secciones); comparar su forma serializada evita que una lista con los mismos
 * elementos cuente como un cambio solo por ser otro arreglo.
 */
function esIgual(antes: unknown, despues: unknown): boolean {
  if (antes === despues) return true
  return JSON.stringify(antes ?? null) === JSON.stringify(despues ?? null)
}

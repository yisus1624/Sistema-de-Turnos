/**
 * El detalle de un evento, en una linea que se pueda leer.
 *
 * Vive fuera de la pantalla porque tiene reglas propias y se puede probar: la
 * columna mostraba `cambios: [object Object]` en cuanto el detalle dejo de ser
 * plano, que es justo cuando empezo a valer para algo (el antes y el despues de
 * cada campo).
 */

const SIN_VALOR = 'sin asignar'

export function resumirDetalle(detalle?: Record<string, unknown>): string {
  if (!detalle) return '—'

  const partes = Object.entries(desplegarCambios(detalle))
    .filter(([, valor]) => valor !== null && valor !== undefined && valor !== '')
    .map(([clave, valor]) => `${clave}: ${comoTexto(valor)}`)

  return partes.length > 0 ? partes.join(' · ') : '—'
}

/**
 * `cambios` se abre al mismo nivel que el resto.
 *
 * Lo que se busca en el registro es el campo que cambio ("jornada"), no la
 * palabra "cambios": anidarlo solo mete un escalon entre quien lee y el dato.
 */
function desplegarCambios(detalle: Record<string, unknown>): Record<string, unknown> {
  const { cambios, ...resto } = detalle
  if (!esObjeto(cambios)) return detalle
  return { ...resto, ...cambios }
}

function comoTexto(valor: unknown): string {
  if (Array.isArray(valor)) return valor.map(comoTexto).join(', ')
  if (esCambioDeCampo(valor)) return `${comoValor(valor.antes)} -> ${comoValor(valor.despues)}`
  return comoValor(valor)
}

function comoValor(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return SIN_VALOR
  if (Array.isArray(valor)) return valor.map(comoTexto).join(', ')
  return String(valor)
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function esCambioDeCampo(valor: unknown): valor is { antes: unknown; despues: unknown } {
  return esObjeto(valor) && 'antes' in valor && 'despues' in valor
}

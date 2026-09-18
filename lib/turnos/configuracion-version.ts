/**
 * Que dos administradores no se pisen al guardar los parametros generales.
 *
 * La pantalla de configuracion manda el objeto ENTERO cada vez que se pulsa
 * guardar, no solo lo que se toco. Si dos administradores la tienen abierta, el
 * segundo en guardar revierte en silencio lo que acaba de cambiar el primero, y
 * ahi dentro estan las jornadas y la duracion de la consulta, que le mueven la
 * agenda a todo el hospital.
 *
 * La solucion es la de siempre: quien guarda declara QUE VERSION VIO. Si ya no
 * es la que hay, no se escribe.
 */
import { errorDeNegocio } from './errores'

export const CONFIGURACION_YA_CAMBIADA =
  'Otro administrador cambio la configuracion mientras tenias esta pantalla abierta. Vuelve a cargarla y repite tu cambio para no deshacer el suyo.'

/**
 * @param actual Marca que tiene la configuracion guardada ahora mismo.
 * @param visto Marca que tenia cuando el administrador abrio la pantalla.
 */
export function exigirConfiguracionAlDia(actual: string, visto?: string) {
  // Sin marca no hay nada que comparar: son los usos sin pantalla (siembra,
  // scripts), que no compiten con nadie.
  if (!visto || visto === actual) return

  errorDeNegocio(CONFIGURACION_YA_CAMBIADA)
}

/**
 * La marca siguiente, que SIEMPRE avanza.
 *
 * Con la hora a secas, dos guardados dentro del mismo milisegundo dejarian la
 * misma firma y el segundo administrador volveria a pisar al primero sin que
 * nada lo notara.
 */
export function marcaSiguiente(anterior: string): string {
  const ahora = Date.now()
  const previa = new Date(anterior).getTime()
  return new Date(Math.max(ahora, previa + 1)).toISOString()
}

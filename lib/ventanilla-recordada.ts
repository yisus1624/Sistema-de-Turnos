/**
 * Que ventanilla eligio este equipo para cada servicio.
 *
 * POR QUE EXISTE. La pantalla del operador preseleccionaba SIEMPRE la primera
 * ventanilla de la lista. Dos operadores que abrian la pantalla quedaban los dos
 * en la "Ventanilla 1" sin darse cuenta, y el llamado de uno cerraba al
 * paciente del otro. Ahora se recuerda la que este equipo eligio; si no eligio
 * ninguna y hay mas de una, no se preselecciona: la elige una persona.
 *
 * `localStorage` puede no existir o fallar (modo privado, cuota, politicas del
 * equipo): recordar es una comodidad y nunca puede romper la pantalla, por eso
 * todo va en try/catch.
 */
import type { Modulo } from '@/lib/turnos/types'

const PREFIJO = 'turnos:ventanilla:'

function almacen(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function recordarVentanilla(servicioId: string, moduloId: string) {
  try {
    almacen()?.setItem(PREFIJO + servicioId, moduloId)
  } catch {
    // Sin donde guardarlo, la proxima vez se elige a mano.
  }
}

function ventanillaGuardada(servicioId: string): string | null {
  try {
    return almacen()?.getItem(PREFIJO + servicioId) ?? null
  } catch {
    return null
  }
}

/**
 * La ventanilla con la que arranca la pantalla para ese servicio: la recordada
 * si sigue disponible; si no, la unica que haya; si hay varias, ninguna.
 */
export function ventanillaInicial(servicioId: string, disponibles: Modulo[], guardada = ventanillaGuardada(servicioId)): string {
  if (guardada && disponibles.some((m) => m.id === guardada)) return guardada
  return disponibles.length === 1 ? disponibles[0].id : ''
}

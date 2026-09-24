/**
 * "Llamar al siguiente" desde una pantalla, contando lo que la pantalla ve.
 *
 * Lo comparten el consultorio y la ventanilla. Manda el turno que la pantalla
 * cree tener abierto; si el servidor responde que el real es otro (409: se
 * perdio la respuesta de un llamado anterior, o fue un doble clic), no es un
 * error para el funcionario sino un "ponte al dia": se devuelve ese turno real
 * para pintarlo y avisar, en vez de un aviso rojo sobre la pantalla vieja.
 */
import { ErrorApi, pedir, turnoRealDelConflicto, type OpcionesPedir } from './cliente'
import type { Turno } from '@/lib/turnos/types'

export type DesenlaceDelLlamado =
  | { tipo: 'llamado'; turno: Turno }
  | { tipo: 'ya_tenia_uno'; turno: Turno }

/**
 * Esperas antes de reintentar cuando el servidor responde "ocupado" (503).
 *
 * En hora pico varios doctores llaman a la vez y la base puede no tener
 * conexion libre para todos en el mismo instante: el servidor rechaza el
 * llamado ENTERO (va en una transaccion, no queda nada a medias) y responde
 * 503. Reintentar es seguro, y evita que el doctor vea "sistema ocupado" y
 * tenga que volver a pulsar; con el turno visto de siempre, un reintento que
 * llegara tarde se resuelve como un 409 normal.
 */
export const ESPERAS_SI_OCUPADO_MS: readonly number[] = [700, 1500, 3000]

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))
const estaOcupado = (error: unknown) => error instanceof ErrorApi && error.status === 503

export async function llamarSiguienteDesde(
  url: string,
  // Lo que no viene (undefined) no viaja: `JSON.stringify` lo omite.
  cuerpo: Record<string, string | undefined>,
  opciones: OpcionesPedir & { turnoVisto: Turno | null; esperasSiOcupado?: readonly number[] },
): Promise<DesenlaceDelLlamado> {
  const { turnoVisto, esperasSiOcupado = ESPERAS_SI_OCUPADO_MS, ...init } = opciones
  for (let intento = 0; ; intento += 1) {
    try {
      const { turno } = await pedir<{ turno: Turno }>(url, {
        ...init,
        method: 'POST',
        body: JSON.stringify({ ...cuerpo, turnoAbiertoId: turnoVisto?.id ?? null }),
      })
      return { tipo: 'llamado', turno }
    } catch (error) {
      if (estaOcupado(error) && intento < esperasSiOcupado.length) {
        await esperar(esperasSiOcupado[intento] + Math.random() * 300)
        continue
      }
      const real = turnoRealDelConflicto(error)
      if (!real) throw error
      return { tipo: 'ya_tenia_uno', turno: real }
    }
  }
}

/** El aviso para el funcionario cuando ya tenia un paciente llamado. */
export function avisoDePacienteYaLlamado(turno: Turno): string {
  return `${turno.nombrePaciente ?? `El turno ${turno.codigo}`} ya fue llamado. Cierralo o repitelo antes de llamar al siguiente.`
}

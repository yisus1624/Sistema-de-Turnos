/**
 * Cliente HTTP minimo para las pantallas internas.
 *
 * Lanza `Error` con el mensaje que devuelve la API, para que cada pantalla lo
 * muestre tal cual en su aviso en lugar de un texto generico.
 */
export async function pedir<T>(url: string, opciones?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...opciones?.headers },
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? 'Ocurrio un error inesperado.')
  return data as T
}

export function mensajeDeError(error: unknown) {
  return error instanceof Error ? error.message : undefined
}

/** Fecha de hoy en Colombia, en formato AAAA-MM-DD (para inputs `type="date"`). */
export function hoyEnColombia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

export function horaCorta(iso?: string | null) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

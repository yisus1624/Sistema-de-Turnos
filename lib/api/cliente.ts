/** Error de la API que conserva el codigo HTTP, para poder distinguir un 401. */
export class ErrorApi extends Error {
  readonly status: number

  constructor(mensaje: string, status: number) {
    super(mensaje)
    this.name = 'ErrorApi'
    this.status = status
  }
}

export type OpcionesPedir = RequestInit & {
  /**
   * Desactiva el envio al login cuando la respuesta es 401.
   *
   * Lo usa la pantalla del doctor, que no entra con sesion sino con un enlace
   * temporal: ahi un 401 significa "el enlace vencio", y mandarlo a un login
   * donde no tiene cuenta no le sirve de nada. Esa pantalla ya muestra su
   * propio aviso.
   */
  sinRedirigirAlLogin?: boolean
}

/**
 * Cliente HTTP minimo para las pantallas internas.
 *
 * Lanza `ErrorApi` con el mensaje que devuelve la API, para que cada pantalla
 * lo muestre tal cual en su aviso en lugar de un texto generico.
 *
 * SESION CAIDA: un 401 manda al login. Antes no, y el resultado era peligroso
 * en un mostrador: la sesion dura una jornada, asi que vencia estando el
 * funcionario trabajando (o caia en el acto si el administrador desactivaba la
 * cuenta). A partir de ahi la pantalla seguia mostrando los datos de antes
 * —pacientes, citas, la fila— y cada accion respondia "No autorizado" en un
 * aviso pequeño. Nadie lee eso como "volve a entrar": se lee como un error
 * raro, se reintenta, y entretanto se cree haber registrado llegadas que no se
 * registraron.
 */
export async function pedir<T>(url: string, opciones?: OpcionesPedir): Promise<T> {
  const { sinRedirigirAlLogin, ...init } = opciones ?? {}

  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const mensaje = (data as { error?: string })?.error ?? 'Ocurrio un error inesperado.'

    if (res.status === 401 && !sinRedirigirAlLogin && typeof window !== 'undefined') {
      // Se vuelve aqui despues de entrar, para que el funcionario retome donde
      // estaba en vez de aparecer en la pantalla de inicio.
      const volverA = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `/auth/login?sesion=expirada&volverA=${volverA}`
    }

    throw new ErrorApi(mensaje, res.status)
  }

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

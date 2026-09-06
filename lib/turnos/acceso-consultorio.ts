/**
 * Autenticacion por token para las rutas del consultorio del profesional.
 *
 * El doctor entra por un enlace temporal, sin usuario ni contrasena (ver
 * `lib/turnos/in-memory-repository.ts`, `crearAccesoProfesional`). Estas
 * rutas NO usan `requireRol`: la sesion aqui es el token de la URL.
 *
 * Se limitan los intentos por token para que no se pueda adivinar por fuerza
 * bruta (el token es aleatorio de 32 bytes, pero igual se acota el ritmo de
 * peticiones fallidas).
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from './repositorio'
import type { Profesional } from './types'
import { contextoPeticion, limitarIntentos, registrarEvento } from '@/lib/seguridad/registro'

export class AccesoInvalidoError extends Error {
  readonly status = 401

  constructor() {
    super('El enlace no es valido o ya vencio. Pide un enlace nuevo a la oficina de sistemas.')
    this.name = 'AccesoInvalidoError'
  }
}

/**
 * Valida el token de la ruta y devuelve el profesional. Lanza
 * `AccesoInvalidoError` (401) si no sirve, para que `apiError` lo traduzca
 * sin exponer detalles del motivo (no existe / vencio / fue revocado se ven
 * igual desde afuera, a proposito).
 */
export async function requireProfesionalPorToken(token: string): Promise<Profesional> {
  const { ip } = await contextoPeticion()

  const limite = limitarIntentos('token_consultorio', token, 30, 5 * 60 * 1000)
  if (!limite.permitido) {
    registrarEvento({ tipo: 'ACCESO_PROFESIONAL', exito: false, ip, detalle: { motivo: 'demasiados_intentos' } })
    throw new AccesoInvalidoError()
  }

  const profesional = await turnoRepository.validarAccesoProfesional(token)
  if (!profesional) {
    registrarEvento({ tipo: 'ACCESO_PROFESIONAL', exito: false, ip, detalle: { motivo: 'token_invalido' } })
    throw new AccesoInvalidoError()
  }

  if (debeRegistrarAcceso(profesional.id)) {
    registrarEvento({
      tipo: 'ACCESO_PROFESIONAL',
      exito: true,
      ip,
      identificador: profesional.id,
      detalle: { profesional: profesional.nombre },
    })
  }

  return profesional
}

/**
 * Cuanto se deja pasar entre dos apuntes de "este doctor esta usando su
 * enlace". Diez minutos: sigue mostrando quien estuvo conectado y cuando, sin
 * escribir una linea por peticion.
 */
const MS_ENTRE_APUNTES_DE_ACCESO = 10 * 60 * 1000

declare global {
  var __turnosUltimoAccesoRegistrado: Map<string, number> | undefined
}

const ultimoApunte: Map<string, number> =
  globalThis.__turnosUltimoAccesoRegistrado ?? new Map()
globalThis.__turnosUltimoAccesoRegistrado = ultimoApunte

/**
 * Si toca dejar constancia de este acceso.
 *
 * La pantalla del doctor se refresca sola y cada refresco pasa por aqui: se
 * escribia un evento de exito por peticion, contra un registro que solo guarda
 * los ultimos 500. Con varios consultorios abiertos, ese goteo barria en
 * minutos lo que de verdad hay que poder revisar despues (los intentos de
 * entrada fallidos). El acceso se sigue registrando, pero espaciado.
 *
 * Los fallos NUNCA se agrupan: esos se apuntan siempre.
 */
function debeRegistrarAcceso(profesionalId: string): boolean {
  const ahora = Date.now()
  const anterior = ultimoApunte.get(profesionalId)
  if (anterior !== undefined && ahora - anterior < MS_ENTRE_APUNTES_DE_ACCESO) return false

  ultimoApunte.set(profesionalId, ahora)
  return true
}

/** Mismo formato de error que `apiError`, para las rutas del consultorio. */
export function errorConsultorio(error: unknown) {
  if (error instanceof AccesoInvalidoError) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: unknown }).status) : 500
  const message = error instanceof Error ? error.message : 'Ocurrio un error inesperado.'
  return NextResponse.json({ error: message }, { status: Number.isFinite(status) ? status : 500 })
}

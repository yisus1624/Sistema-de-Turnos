/**
 * El rastro de los llamados.
 *
 * Llamar y repetir no dejaban nada escrito, y son las dos acciones mas visibles
 * para el paciente: su numero suena en la sala y aparece en la pantalla. Ademas
 * es el unico camino del sistema que no pasa por usuario y contrasena —el
 * doctor entra por un enlace temporal—, asi que si el llamado no se apunta, de
 * lo que pasa en el consultorio no queda constancia de ninguna clase.
 *
 * Los dos eventos se arman aqui y no en cada ruta porque son cuatro rutas
 * distintas (consultorio y operador, llamar y repetir) contando lo mismo.
 */
import { EVENTOS } from '@/lib/seguridad/eventos'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { nombreDeModulo, nombreDeProfesional } from './catalogo-nombres'
import type { Turno } from './types'

/**
 * Quien pulso el boton.
 *
 * Va vacio cuando llama el doctor por su enlace: no tiene cuenta en el sistema,
 * asi que su nombre queda en el detalle y no en `usuarioId`, igual que en el
 * cierre del turno.
 */
export interface QuienLlama {
  usuarioId?: string | null
  usuarioNombre?: string | null
}

export async function registrarLlamado(turno: Turno, quien: QuienLlama = {}) {
  await apuntarSinTumbar(EVENTOS.TURNO_LLAMADO, turno, quien)
}

export async function registrarRepeticion(turno: Turno, quien: QuienLlama = {}) {
  await apuntarSinTumbar(EVENTOS.TURNO_REPETIDO, turno, quien)
}

/**
 * El cierre de un turno (atendido o ausente).
 *
 * Vivia repetido en cuatro rutas, dos con la IP y dos sin ella: el mismo cierre
 * dejaba un rastro distinto segun desde que pantalla se hiciera.
 */
export async function registrarCierre(
  tipo: string,
  turno: Turno,
  quien: QuienLlama & { detalle?: Record<string, unknown> } = {},
) {
  await sinTumbar(async () => {
    const { ip } = await contextoPeticion()
    await registrarEvento({ tipo, exito: true, ...firma(quien), identificador: turno.codigo, ip, detalle: quien.detalle })
  })
}

/**
 * El apunte NUNCA tumba la accion que audita.
 *
 * Llega despues de que el llamado o el cierre ya quedaron guardados. Si armar
 * el detalle falla (una consulta de nombres que se cae), responder error le
 * haria creer al funcionario que no paso nada, y al reintentar cerraria o
 * llamaria a otro paciente. Se grita en el registro del servidor y se sigue.
 */
async function sinTumbar(apuntar: () => Promise<void>) {
  try {
    await apuntar()
  } catch (error) {
    console.error('[rastro] la accion quedo hecha pero no se pudo apuntar', error)
  }
}

function firma(quien: QuienLlama) {
  return { usuarioId: quien.usuarioId ?? null, usuarioNombre: quien.usuarioNombre ?? null }
}

async function apuntarSinTumbar(tipo: string, turno: Turno, quien: QuienLlama) {
  await sinTumbar(async () => {
    const { ip } = await contextoPeticion()
    await registrarEvento({
      tipo,
      exito: true,
      ...firma(quien),
      // El codigo del turno, no su id: es lo que el paciente vio y lo que se
      // puede buscar despues.
      identificador: turno.codigo,
      ip,
      detalle: await detalleDelLlamado(turno),
    })
  })
}

async function detalleDelLlamado(turno: Turno): Promise<Record<string, unknown>> {
  const [profesional, modulo] = await Promise.all([
    nombreDeProfesional(turno.profesionalId),
    nombreDeModulo(turno.moduloId),
  ])

  return { profesional, modulo, vecesLlamado: turno.vecesLlamado }
}

/**
 * El PIN de UN medico: sortearlo (o cambiarlo), activarlo o desactivarlo, y
 * eliminarlo. Solo el administrador (seccion "PIN de medicos").
 *
 * El PIN lo sortea el sistema (ver `lib/turnos/reglas-pin.ts`): nunca se
 * escribe a mano, para que no termine siendo 123456 o la cedula del medico.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS, type TipoEvento } from '@/lib/seguridad/eventos'

export const dynamic = 'force-dynamic'

type Contexto = { params: Promise<{ id: string }> }

async function apuntar(tipo: TipoEvento, profesionalId: string) {
  const session = await requireSeccion('/admin/pines')
  // Que se hizo y a quien; el PIN no se apunta nunca.
  await registrarEvento({
    tipo,
    exito: true,
    usuarioId: session.user.id,
    usuarioNombre: session.user.name ?? null,
    identificador: session.user.usuario,
    ip: (await contextoPeticion()).ip,
    detalle: { profesionalId },
  })
}

/** Sortea un PIN nuevo. Si el medico ya tenia uno, el anterior deja de servir. */
export async function POST(_request: Request, contexto: Contexto) {
  try {
    await requireSeccion('/admin/pines')
    const { id } = await contexto.params
    const { pin } = await turnoRepository.asignarPin(id)
    await apuntar(EVENTOS.PIN_ASIGNADO, id)
    return NextResponse.json({ pin })
  } catch (error) {
    return apiError(error)
  }
}

const estadoSchema = z.object({ activo: z.boolean({ required_error: 'Indica si el PIN queda activo.' }) })

export async function PATCH(request: Request, contexto: Contexto) {
  try {
    await requireSeccion('/admin/pines')
    const { id } = await contexto.params
    const parsed = estadoSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }
    const pin = await turnoRepository.cambiarEstadoPin(id, parsed.data.activo)
    await apuntar(parsed.data.activo ? EVENTOS.PIN_ACTIVADO : EVENTOS.PIN_DESACTIVADO, id)
    return NextResponse.json({ pin })
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(_request: Request, contexto: Contexto) {
  try {
    await requireSeccion('/admin/pines')
    const { id } = await contexto.params
    await turnoRepository.eliminarPin(id)
    await apuntar(EVENTOS.PIN_ELIMINADO, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

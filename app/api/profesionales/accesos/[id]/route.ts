import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/admin/profesionales')

    const { id } = await context.params
    const acceso = await turnoRepository.revocarAccesoProfesional(id)

    registrarEvento({
      tipo: 'ACCESO_PROFESIONAL_REVOCADO',
      exito: true,
      usuarioId: session.user.id,
      identificador: acceso.profesionalId,
    })

    return NextResponse.json({ acceso })
  } catch (error) {
    return apiError(error)
  }
}

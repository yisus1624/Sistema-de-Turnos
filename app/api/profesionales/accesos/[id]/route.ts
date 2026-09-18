import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { nombreDeProfesional } from '@/lib/turnos/catalogo-nombres'

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/admin/enlaces')

    const { id } = await context.params
    const acceso = await turnoRepository.revocarAccesoProfesional(id)

    // Cortar un enlace antes de tiempo es una decision que alguien puede tener
    // que explicar: queda de quien era la llave y hasta cuando iba a valer, que
    // es lo que dice cuanto se le recorto.
    const { ip } = await contextoPeticion()
    const doctor = await nombreDeProfesional(acceso.profesionalId)
    await registrarEvento({
      tipo: EVENTOS.ACCESO_PROFESIONAL_REVOCADO,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: doctor ?? acceso.profesionalId,
      ip,
      detalle: { profesional: doctor, accesoId: acceso.id, expiraEn: acceso.expiraEn },
    })

    return NextResponse.json({ acceso })
  } catch (error) {
    return apiError(error)
  }
}

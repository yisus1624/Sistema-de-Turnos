import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { errorConsultorio, requireProfesionalPorToken } from '@/lib/turnos/acceso-consultorio'
import { verificarTurnoDelProfesional } from '@/lib/turnos/acceso-consultorio-turno'
import { registrarEvento } from '@/lib/seguridad/registro'

export async function POST(_request: Request, context: { params: Promise<{ token: string; turnoId: string }> }) {
  try {
    const { token, turnoId } = await context.params
    const profesional = await requireProfesionalPorToken(token)
    await verificarTurnoDelProfesional(turnoId, profesional.id)

    // El doctor entra por enlace y no tiene cuenta: queda su id de profesional
    // como responsable del cierre.
    const turno = await turnoRepository.marcarAtendido(turnoId, profesional.id)

    registrarEvento({
      tipo: 'TURNO_ATENDIDO',
      exito: true,
      identificador: turno.codigo,
      detalle: { profesional: profesional.nombre },
    })

    return NextResponse.json({ turno })
  } catch (error) {
    return errorConsultorio(error)
  }
}

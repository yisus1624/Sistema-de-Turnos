import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { errorConsultorio, requireProfesionalDelConsultorio } from '@/lib/turnos/acceso-consultorio'
import { verificarTurnoDelProfesional } from '@/lib/turnos/acceso-consultorio-turno'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'

export async function POST(request: Request, context: { params: Promise<{ turnoId: string }> }) {
  try {
    const { turnoId } = await context.params
    const profesional = await requireProfesionalDelConsultorio(request)
    await verificarTurnoDelProfesional(turnoId, profesional.id)

    // El doctor entra por enlace y no tiene cuenta: queda su id de profesional
    // como responsable del cierre.
    const turno = await turnoRepository.marcarAtendido(turnoId, profesional.id)

    // Mismo origen que el resto del rastro del consultorio: sin la IP no se
    // puede saber desde que equipo se cerro el turno.
    const { ip } = await contextoPeticion()
    await registrarEvento({
      tipo: EVENTOS.TURNO_ATENDIDO,
      exito: true,
      identificador: turno.codigo,
      ip,
      detalle: { profesional: profesional.nombre },
    })

    return NextResponse.json({ turno })
  } catch (error) {
    return errorConsultorio(error)
  }
}

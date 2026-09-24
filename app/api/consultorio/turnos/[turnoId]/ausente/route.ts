import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { errorConsultorio, requireProfesionalDeLaPantalla } from '@/lib/turnos/acceso-consultorio'
import { verificarTurnoDelProfesional } from '@/lib/turnos/acceso-consultorio-turno'
import { registrarCierre } from '@/lib/turnos/rastro-llamado'
import { EVENTOS } from '@/lib/seguridad/eventos'

export async function POST(request: Request, context: { params: Promise<{ turnoId: string }> }) {
  try {
    const { turnoId } = await context.params
    const { profesional } = await requireProfesionalDeLaPantalla(request)
    await verificarTurnoDelProfesional(turnoId, profesional.id)

    // El doctor entra por enlace y no tiene cuenta: queda su id de profesional
    // como responsable del cierre, y su nombre en el detalle del apunte.
    const { turno, yaAplicada } = await turnoRepository.marcarAusente(turnoId, profesional.id)

    // Idempotente: el reintento tras una respuesta perdida no se apunta dos veces.
    if (!yaAplicada) {
      await registrarCierre(EVENTOS.TURNO_AUSENTE, turno, { detalle: { profesional: profesional.nombre } })
    }

    return NextResponse.json({ turno, yaAplicada })
  } catch (error) {
    return errorConsultorio(error)
  }
}

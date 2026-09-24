import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { errorConsultorio, requireProfesionalDeLaPantalla } from '@/lib/turnos/acceso-consultorio'
import { verificarTurnoDelProfesional } from '@/lib/turnos/acceso-consultorio-turno'
import { registrarRepeticion } from '@/lib/turnos/rastro-llamado'
import { repetirSchema } from '@/lib/validators/turnos'

export async function POST(request: Request, context: { params: Promise<{ turnoId: string }> }) {
  try {
    const { turnoId } = await context.params
    const { profesional, cuerpo } = await requireProfesionalDeLaPantalla(request)
    await verificarTurnoDelProfesional(turnoId, profesional.id)

    const visto = repetirSchema.safeParse(cuerpo)
    const { turno, yaAplicada } = await turnoRepository.repetirLlamado(turnoId, {
      vecesLlamadoVisto: visto.success ? visto.data?.vecesLlamadoVisto : undefined,
    })

    // Se apunta aparte del primer llamado: un numero que se repite tres veces
    // es lo que hay que poder reconstruir cuando un paciente reclama que nunca
    // lo llamaron. El reintento de una repeticion ya hecha no se apunta.
    if (!yaAplicada) await registrarRepeticion(turno)

    return NextResponse.json({ turno, yaAplicada })
  } catch (error) {
    return errorConsultorio(error)
  }
}

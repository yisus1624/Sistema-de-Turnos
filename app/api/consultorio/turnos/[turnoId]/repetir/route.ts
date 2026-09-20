import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { errorConsultorio, requireProfesionalDelConsultorio } from '@/lib/turnos/acceso-consultorio'
import { verificarTurnoDelProfesional } from '@/lib/turnos/acceso-consultorio-turno'
import { registrarRepeticion } from '@/lib/turnos/rastro-llamado'

export async function POST(request: Request, context: { params: Promise<{ turnoId: string }> }) {
  try {
    const { turnoId } = await context.params
    const profesional = await requireProfesionalDelConsultorio(request)
    await verificarTurnoDelProfesional(turnoId, profesional.id)

    const turno = await turnoRepository.repetirLlamado(turnoId)

    // Se apunta aparte del primer llamado: un numero que se repite tres veces
    // es lo que hay que poder reconstruir cuando un paciente reclama que nunca
    // lo llamaron.
    await registrarRepeticion(turno)

    return NextResponse.json({ turno })
  } catch (error) {
    return errorConsultorio(error)
  }
}

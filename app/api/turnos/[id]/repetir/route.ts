import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { verificarTurnoDeLaVentanilla } from '@/lib/turnos/acceso-ventanilla'
import { registrarRepeticion } from '@/lib/turnos/rastro-llamado'
import { cuerpoJson, idDeTurnoValido, repetirSchema } from '@/lib/validators/turnos'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/operador')

    // El id se valida y el turno tiene que ser de ESTE operador (fila
    // compartida, llamado por el): ver `verificarTurnoDeLaVentanilla`.
    const id = idDeTurnoValido((await context.params).id)
    await verificarTurnoDeLaVentanilla(id, session.user.id)
    const cuerpo = repetirSchema.safeParse(await cuerpoJson(request))
    const { turno, yaAplicada } = await turnoRepository.repetirLlamado(id, {
      vecesLlamadoVisto: cuerpo.success ? cuerpo.data?.vecesLlamadoVisto : undefined,
    })

    // El reintento de una repeticion que ya se hizo no se apunta otra vez.
    if (!yaAplicada) {
      await registrarRepeticion(turno, { usuarioId: session.user.id, usuarioNombre: session.user.name ?? null })
    }

    return NextResponse.json({ turno, yaAplicada })
  } catch (error) {
    return apiError(error)
  }
}

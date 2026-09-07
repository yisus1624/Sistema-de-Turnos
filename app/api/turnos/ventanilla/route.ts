/**
 * Turno de ventanilla: servicios sin cita previa (admisiones, facturacion,
 * SIAU), donde la fila es por orden de llegada. Los servicios que atienden por
 * cita generan el turno al registrar la llegada del paciente.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { avisarFilaCambiada } from '@/lib/realtime/avisos'

const bodySchema = z.object({
  servicioId: z.string().min(1, 'Debes indicar el servicio.'),
})

export async function POST(request: Request) {
  try {
    await requireSeccion('/operador')

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const turno = await turnoRepository.generarTurnoDeVentanilla(parsed.data.servicioId)

    // La fila compartida la atienden varias ventanillas a la vez: el turno que
    // genera una tiene que aparecerle a la otra sin que pulse nada.
    avisarFilaCambiada(turno)

    return NextResponse.json({ turno })
  } catch (error) {
    return apiError(error)
  }
}

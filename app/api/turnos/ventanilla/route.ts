/**
 * Turno de ventanilla: servicios sin cita previa (admisiones, facturacion,
 * SIAU), donde la fila es por orden de llegada. Los servicios que atienden por
 * cita generan el turno al registrar la llegada del paciente.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

const bodySchema = z.object({
  servicioId: z.string().min(1, 'Debes indicar el servicio.'),
})

export async function POST(request: Request) {
  try {
    await requireRol(['OPERADOR', 'ADMINISTRADOR'])

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const turno = await turnoRepository.generarTurnoDeVentanilla(parsed.data.servicioId)
    return NextResponse.json({ turno })
  } catch (error) {
    return apiError(error)
  }
}

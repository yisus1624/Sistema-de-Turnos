import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { errorConsultorio, requireProfesionalDelConsultorio } from '@/lib/turnos/acceso-consultorio'
import { registrarLlamado } from '@/lib/turnos/rastro-llamado'

const bodySchema = z.object({
  moduloId: z.string().min(1, 'Debes indicar el consultorio.'),
})

export async function POST(request: Request) {
  try {
    const profesional = await requireProfesionalDelConsultorio(request)

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const turno = await turnoRepository.llamarSiguiente({
      profesionalId: profesional.id,
      moduloId: parsed.data.moduloId,
      // No hay usuario de sistema: el propio profesional queda como quien llamo.
      funcionarioId: profesional.id,
    })

    if (!turno) {
      return NextResponse.json({ error: 'No hay pacientes en espera.' }, { status: 404 })
    }

    // El doctor entra por enlace y no tiene cuenta: queda su nombre en el
    // detalle, igual que en el cierre del turno.
    await registrarLlamado(turno)

    return NextResponse.json({ turno })
  } catch (error) {
    return errorConsultorio(error)
  }
}

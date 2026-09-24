import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { errorConsultorio, requireProfesionalDeLaPantalla } from '@/lib/turnos/acceso-consultorio'
import { consultorioDelProfesional } from '@/lib/turnos/reglas-llamado'
import { registrarLlamado } from '@/lib/turnos/rastro-llamado'
import { PIDE_RECARGAR, faltaElTurnoVisto, turnoAbiertoIdSchema } from '@/lib/validators/turnos'

// El `moduloId` que todavia manda la pantalla ya no se lee: el consultorio es
// el asignado al doctor (ver `consultorioDelProfesional`).
const bodySchema = z.object({
  // El turno que el doctor ve abierto. Si el real es otro (se perdio la
  // respuesta de un llamado anterior), el servidor responde 409 con el real en
  // vez de llamar a otro paciente y cerrar al primero sin que haya entrado.
  turnoAbiertoId: turnoAbiertoIdSchema,
})

export async function POST(request: Request) {
  try {
    const { profesional, cuerpo } = await requireProfesionalDeLaPantalla(request)

    if (faltaElTurnoVisto(cuerpo)) return NextResponse.json({ error: PIDE_RECARGAR }, { status: 400 })

    const parsed = bodySchema.safeParse(cuerpo)
    if (!parsed.success) return NextResponse.json({ error: PIDE_RECARGAR }, { status: 400 })

    const turno = await turnoRepository.llamarSiguiente({
      profesionalId: profesional.id,
      moduloId: consultorioDelProfesional(profesional),
      // No hay usuario de sistema: el propio profesional queda como quien llamo.
      funcionarioId: profesional.id,
      turnoAbiertoEsperado: parsed.data.turnoAbiertoId,
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

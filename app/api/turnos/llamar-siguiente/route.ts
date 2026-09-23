import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarLlamado } from '@/lib/turnos/rastro-llamado'
import { PIDE_RECARGAR, cuerpoJson, faltaElTurnoVisto, idSchema, turnoAbiertoIdSchema } from '@/lib/validators/turnos'

/**
 * Solo filas compartidas (ventanillas).
 *
 * Ya no acepta `profesionalId`: con el, un operador podia llevarse a los
 * pacientes de un doctor y, al llamar desde su consultorio, cerrarle al que
 * tuviera adentro. Los pacientes con cita los llama su profesional desde su
 * enlace. El repositorio comprueba ademas que el servicio sea de fila
 * compartida y que la ventanilla le corresponda.
 */
const bodySchema = z.object({
  servicioId: idSchema,
  moduloId: idSchema,
  turnoAbiertoId: turnoAbiertoIdSchema,
})

export async function POST(request: Request) {
  try {
    // El funcionario que llama sale de la sesion, no del cuerpo de la peticion:
    // queda registrado en el historico (requerimiento seccion 23).
    const session = await requireSeccion('/operador')

    const cuerpo = await cuerpoJson(request)
    if (faltaElTurnoVisto(cuerpo)) return NextResponse.json({ error: PIDE_RECARGAR }, { status: 400 })

    const parsed = bodySchema.safeParse(cuerpo)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Debes indicar el servicio y la ventanilla.' }, { status: 400 })
    }

    const turno = await turnoRepository.llamarSiguiente({
      servicioId: parsed.data.servicioId,
      moduloId: parsed.data.moduloId,
      funcionarioId: session.user.id,
      turnoAbiertoEsperado: parsed.data.turnoAbiertoId,
    })

    if (!turno) {
      return NextResponse.json({ error: 'No hay pacientes en espera.' }, { status: 404 })
    }

    await registrarLlamado(turno, {
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
    })

    return NextResponse.json({ turno })
  } catch (error) {
    return apiError(error)
  }
}

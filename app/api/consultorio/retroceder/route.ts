import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { errorConsultorio, requireProfesionalDeLaPantalla } from '@/lib/turnos/acceso-consultorio'
import { registrarCierre } from '@/lib/turnos/rastro-llamado'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { turnoAbiertoIdSchema } from '@/lib/validators/turnos'

/**
 * Lo que el doctor VEIA al pulsar "Retroceder": el paciente en atencion y el
 * que iba a volver. Los dos obligatorios (aunque sean null): sin ellos no se
 * puede saber si el retroceso es el que el doctor confirmo o uno de mas (ver
 * `exigirPlanVisto`).
 */
const bodySchema = z.object({
  turnoAbiertoId: turnoAbiertoIdSchema,
  restaurarId: turnoAbiertoIdSchema,
})

/** Retrocede al turno anterior (ver `lib/turnos/reglas-retroceso.ts`). */
export async function POST(request: Request) {
  try {
    const { profesional, cuerpo } = await requireProfesionalDeLaPantalla(request)

    const parsed = bodySchema.safeParse(cuerpo)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Esta pantalla esta desactualizada. Recarga la pagina.' }, { status: 400 })
    }

    const { devolver, restaurar } = await turnoRepository.retrocederTurno(profesional.id, parsed.data)

    // Deshacer borra la hora del llamado: sin este apunte no quedaria rastro de
    // que ese paciente se llamo y se devolvio a la fila.
    const turno = restaurar ?? devolver
    if (turno) {
      await registrarCierre(EVENTOS.TURNO_RETROCEDIDO, turno, {
        detalle: {
          profesional: profesional.nombre,
          devueltoALaFila: devolver?.codigo ?? null,
          vuelveAAtencion: restaurar?.codigo ?? null,
        },
      })
    }

    return NextResponse.json({ devuelto: devolver, restaurado: restaurar })
  } catch (error) {
    return errorConsultorio(error)
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'

const SECCIONES_AGENDA = ['/admin/citas', '/operador/agenda', '/admin/pruebas'] as const

/**
 * Reprograma la cita: la mueve de hora, y si hace falta de doctor.
 *
 * Es una operacion propia y no "cancelar y crear otra". Con lo segundo quedaban
 * dos registros sueltos y se perdia el rastro: nada decia que eran el mismo
 * paciente reubicado, ni cuantas veces se le habia movido la cita, que es justo
 * lo que se pregunta cuando alguien viene a reclamar.
 */
const reprogramarSchema = z.object({
  horaCita: z.string().min(1, 'Indica la hora nueva de la cita.'),
  profesionalId: z.string().min(1).optional(),
  motivo: z.string().trim().max(200).optional(),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion(...SECCIONES_AGENDA)

    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = reprogramarSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const cita = await turnoRepository.reprogramarCita(id, {
      ...parsed.data,
      usuarioId: session.user.id,
    })

    registrarEvento({
      tipo: 'CITA_REPROGRAMADA',
      exito: true,
      usuarioId: session.user.id,
      identificador: cita.documentoPaciente,
      detalle: {
        citaId: cita.id,
        horaAnterior: cita.horaCitaOriginal,
        horaNueva: cita.horaCita,
        veces: cita.vecesReprogramada,
        motivo: cita.motivoReprogramacion,
      },
    })

    return NextResponse.json({ cita })
  } catch (error) {
    return apiError(error)
  }
}

const cancelarSchema = z.object({
  motivo: z.string().trim().max(200).optional(),
})

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion(...SECCIONES_AGENDA)
    const { id } = await context.params

    // El motivo llega en el cuerpo. Es opcional para no trancar al mostrador,
    // pero quien y cuando se graban siempre.
    const body = await request.json().catch(() => null)
    const parsed = cancelarSchema.safeParse(body ?? {})
    const motivo = parsed.success ? parsed.data.motivo : undefined

    const cita = await turnoRepository.cancelarCita(id, { usuarioId: session.user.id, motivo })

    registrarEvento({
      tipo: 'CITA_CANCELADA',
      exito: true,
      usuarioId: session.user.id,
      identificador: cita.documentoPaciente,
      detalle: { citaId: cita.id, horaCita: cita.horaCita, motivo: cita.motivoCancelacion },
    })

    return NextResponse.json({ cita })
  } catch (error) {
    return apiError(error)
  }
}

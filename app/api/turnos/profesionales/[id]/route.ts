import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { camposCambiados } from '@/lib/seguridad/cambios'
import { fichaLegible, fichaLegiblePorId } from '@/lib/turnos/rastro-profesional'

const cambioSchema = z.object({
  nombre: z.string().trim().min(3, 'Ingresa el nombre del profesional.').max(80).optional(),
  servicioId: z.string().min(1).optional(),
  jornada: z.enum(['MANANA', 'TARDE', 'COMPLETA']).optional(),
  moduloId: z.string().nullable().optional(),
  activo: z.boolean().optional(),
})

/**
 * Edita un doctor. No hay DELETE a proposito: un profesional se desactiva
 * (`activo: false`), porque su nombre aparece en el historico de los turnos
 * que ya llamo y borrarlo dejaria ese rastro huerfano.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/admin/profesionales')

    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = cambioSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    // La ficha de antes se lee ANTES de escribir: es la mitad del apunte que
    // faltaba. Con solo el despues, mover tres doctores de consultorio un
    // viernes no se puede deshacer el lunes.
    const antes = await fichaLegiblePorId(id)
    const profesional = await turnoRepository.actualizarProfesional(id, parsed.data)
    const despues = await fichaLegible(profesional)

    // Dar de baja a un doctor invalida su enlace de consultorio y le quita la
    // fila de pacientes. Es de las cosas que hay que poder explicar despues.
    const { ip } = await contextoPeticion()
    await registrarEvento({
      tipo: EVENTOS.PROFESIONAL_ACTUALIZADO,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: profesional.nombre,
      ip,
      detalle: { cambios: camposCambiados(antes, despues) },
    })

    return NextResponse.json({ profesional })
  } catch (error) {
    return apiError(error)
  }
}

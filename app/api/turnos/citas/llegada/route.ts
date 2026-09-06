import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'

const bodySchema = z.object({
  citaId: z.string().min(1, 'Debes indicar la cita.'),
})

export async function POST(request: Request) {
  try {
    const session = await requireSeccion('/operador/admisiones', '/admin/citas', '/admin/pruebas')

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const turno = await turnoRepository.registrarLlegada(parsed.data.citaId)

    // Con el turno solo no basta: como la pantalla de la sala de espera ya no
    // muestra nombres, el paciente tiene que salir de admisiones sabiendo su
    // turno, su consultorio y quien lo atiende. Eso es lo que el funcionario
    // le dicta, y va en el mismo viaje para que no haya un instante en que la
    // pantalla diga una cosa y el mostrador otra.
    const comprobante = await turnoRepository.comprobanteDeLlegada(turno.id)

    // La llegada es el momento en que el paciente entra al sistema: es el
    // primer eslabon de la trazabilidad del turno.
    registrarEvento({
      tipo: 'LLEGADA_REGISTRADA',
      exito: true,
      usuarioId: session.user.id,
      identificador: turno.codigo,
      detalle: { citaId: parsed.data.citaId, profesionalId: turno.profesionalId },
    })

    return NextResponse.json({ turno, comprobante })
  } catch (error) {
    return apiError(error)
  }
}

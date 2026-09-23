import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { avisarFilaCambiada } from '@/lib/realtime/avisos'
import { idSchema } from '@/lib/validators/turnos'

const bodySchema = z.object({ citaId: idSchema })

export async function POST(request: Request) {
  try {
    const session = await requireSeccion('/operador/admisiones', '/admin/citas', '/admin/pruebas')

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Debes indicar la cita.' }, { status: 400 })
    }

    const { turno, yaRegistrada } = await turnoRepository.registrarLlegada(parsed.data.citaId)

    // AVISO Y AUDITORIA ANTES DEL COMPROBANTE. Si el comprobante fallara
    // despues del commit y se avisara al final, el reintento entraria por
    // `yaRegistrada`, no avisaria nunca y el doctor no veria al paciente.
    //
    // El aviso va SIEMPRE: es idempotente (solo dice "recarga tu fila") y
    // cubre justo ese caso. El apunte solo la primera vez: la llegada paso una
    // sola vez.
    avisarFilaCambiada(turno)
    if (!yaRegistrada) {
      await registrarEvento({
        tipo: EVENTOS.LLEGADA_REGISTRADA,
        exito: true,
        usuarioId: session.user.id,
        usuarioNombre: session.user.name ?? null,
        identificador: turno.codigo,
        detalle: { citaId: parsed.data.citaId, profesionalId: turno.profesionalId },
      })
    }

    // Con el turno solo no basta: como la pantalla de la sala de espera ya no
    // muestra nombres, el paciente tiene que salir de admisiones sabiendo su
    // turno, su consultorio y quien lo atiende. Eso es lo que el funcionario
    // le dicta, y va en el mismo viaje para que no haya un instante en que la
    // pantalla diga una cosa y el mostrador otra.
    const comprobante = await turnoRepository.comprobanteDeLlegada(turno.id)
    return NextResponse.json({ turno, comprobante, yaRegistrada })
  } catch (error) {
    return apiError(error)
  }
}

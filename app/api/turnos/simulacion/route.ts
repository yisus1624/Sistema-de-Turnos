/**
 * Reinicio de los datos del dia para el panel de simulacion de carga.
 *
 * TEMPORAL (solo pruebas): deja el dia sin turnos y devuelve las citas de hoy
 * a PROGRAMADA. Sin esto, la segunda corrida de la simulacion arranca sin
 * pacientes: las citas ya se gastaron en la primera y ademas el tope de citas
 * por profesional impide seguir agregando.
 *
 * ESTO SE LLEVA POR DELANTE LA JORNADA EN CURSO. Contra la base de verdad no
 * borra ninguna cita (ver `reiniciarDatosDeHoy` en el repositorio de Prisma),
 * pero si borra TODOS los turnos de hoy y deshace el registro de llegada de
 * los pacientes que ya estaban en la fila. Por eso queda cerrada salvo que se
 * abra a proposito con TURNOS_SIMULACION=1: en el hospital, un clic de mas en
 * una pantalla del menu de administracion no puede vaciar la sala de espera.
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { MOTIVO_SIMULACION_APAGADA, simulacionHabilitada } from '@/lib/turnos/simulacion'

/*
 * El interruptor vive en `lib/turnos/simulacion.ts` porque lo lee tambien la
 * pantalla del panel: ahi los botones salen apagados en vez de dejar que el
 * administrador confirme un reinicio que este servidor no va a hacer.
 */

export async function POST() {
  try {
    const session = await requireSeccion('/admin/pruebas')

    if (!simulacionHabilitada()) {
      return NextResponse.json({ error: MOTIVO_SIMULACION_APAGADA }, { status: 403 })
    }

    // Rehacer la jornada es de las cosas que hay que poder rastrear despues.
    await registrarEvento({
      tipo: EVENTOS.SIMULACION_REINICIO_DEL_DIA,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: session.user.usuario,
    })

    await turnoRepository.reiniciarDatosDeHoy()
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

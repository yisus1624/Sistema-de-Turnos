/**
 * Reinicio de los datos del dia para el panel de simulacion de carga.
 *
 * TEMPORAL (solo pruebas): borra los turnos de hoy y vuelve a dejar las citas
 * de ejemplo en PROGRAMADA. Sin esto, la segunda corrida de la simulacion
 * arranca sin pacientes: las citas ya se gastaron en la primera y ademas el
 * tope de citas por profesional impide seguir agregando.
 *
 * ESTA RUTA BORRA DATOS REALES. No distingue una cita de ejemplo de una que
 * acaba de cargar el mostrador: se lleva TODAS las citas y TODOS los turnos
 * del dia. Por eso queda cerrada salvo que se abra a proposito con
 * TURNOS_SIMULACION=1. En el hospital, un clic de mas en una pantalla del menu
 * de administracion no puede costar la agenda de la jornada.
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'

/**
 * Fuera de desarrollo hay que habilitarla explicitamente. La variable se pone
 * en el entorno de pruebas del hospital, nunca en el de produccion.
 */
export function simulacionHabilitada() {
  return process.env.TURNOS_SIMULACION === '1' || process.env.NODE_ENV !== 'production'
}

export async function POST() {
  try {
    const session = await requireSeccion('/admin/pruebas')

    if (!simulacionHabilitada()) {
      return NextResponse.json(
        {
          error:
            'La simulacion de carga esta deshabilitada en este servidor porque borra las citas y los turnos del dia.',
        },
        { status: 403 },
      )
    }

    // Borrar la jornada es de las cosas que hay que poder rastrear despues.
    registrarEvento({
      tipo: 'SIMULACION_REINICIO_DEL_DIA',
      exito: true,
      usuarioId: session.user.id,
      identificador: session.user.usuario,
    })

    await turnoRepository.reiniciarDatosDeHoy()
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

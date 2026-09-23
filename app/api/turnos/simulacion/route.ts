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
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { MOTIVO_SIMULACION_APAGADA, simulacionHabilitada } from '@/lib/turnos/simulacion'
import { avisarDatosReiniciados } from '@/lib/realtime/avisos'
import {
  limpiarSimulacionDeCarga,
  MAXIMO_CONSULTORIOS_SIMULADOS,
  prepararSimulacionDeCarga,
} from '@/lib/turnos/simulacion-carga'

/** Cuantos consultorios llaman a la vez y cuantos pacientes esperan en cada uno. */
const peticionSchema = z.object({
  pacientesPorConsultorio: z.coerce.number().int().min(1).max(20).default(3),
  consultorios: z.coerce.number().int().min(1).max(MAXIMO_CONSULTORIOS_SIMULADOS).default(10),
})

/*
 * El interruptor vive en `lib/turnos/simulacion.ts` porque lo lee tambien la
 * pantalla del panel: ahi los botones salen apagados en vez de dejar que el
 * administrador confirme un reinicio que este servidor no va a hacer.
 */

export async function POST(request: Request) {
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

    const cuerpo = await request.json().catch(() => ({}))
    const peticion = peticionSchema.safeParse(cuerpo ?? {})
    if (!peticion.success) {
      return NextResponse.json(
        { error: `Consultorios: entre 1 y ${MAXIMO_CONSULTORIOS_SIMULADOS}. Pacientes por consultorio: entre 1 y 20.` },
        { status: 400 },
      )
    }

    // Reinicia el dia y deja la sala lista, en una sola peticion (ver
    // `prepararSimulacionDeCarga`): no crea citas, usa las que ya existen.
    const preparada = await prepararSimulacionDeCarga(turnoRepository, peticion.data)
    // Que las pantallas se enteren ya, no en la resincronizacion del minuto.
    avisarDatosReiniciados()
    return NextResponse.json(preparada)
  } catch (error) {
    return apiError(error)
  }
}

/**
 * Detiene la simulacion: deja el dia en blanco y borra los consultorios
 * temporales que creo, para que la pantalla vuelva a mostrar solo los reales.
 */
export async function DELETE() {
  try {
    await requireSeccion('/admin/pruebas')
    if (!simulacionHabilitada()) {
      return NextResponse.json({ error: MOTIVO_SIMULACION_APAGADA }, { status: 403 })
    }

    const consultoriosBorrados = await limpiarSimulacionDeCarga(turnoRepository)
    avisarDatosReiniciados()
    return NextResponse.json({ consultoriosBorrados })
  } catch (error) {
    return apiError(error)
  }
}

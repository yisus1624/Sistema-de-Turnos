/**
 * Busqueda de citas del dia por documento, para que admisiones registre la
 * llegada del paciente.
 *
 * El documento del paciente solo se usa aqui, en una pantalla CON sesion.
 * Nunca sale hacia la pantalla de la sala de espera, ni queda en la URL.
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { z } from 'zod'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { cuerpoJson } from '@/lib/validators/turnos'

/**
 * El documento viaja en el CUERPO, no en la URL: nginx escribe la URL entera
 * en su access.log, y cada busqueda dejaba ahi la cedula del paciente.
 */
const busquedaSchema = z.object({
  documento: z.string().trim().min(4).max(20),
})

export async function POST(request: Request) {
  try {
    await requireSeccion('/operador/admisiones', '/admin/citas')

    const parsed = busquedaSchema.safeParse(await cuerpoJson(request))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Escribe el documento del paciente (entre 4 y 20 digitos).' }, { status: 400 })
    }
    const { documento } = parsed.data

    // `citas` son las de HOY, las unicas a las que se les puede registrar la
    // llegada. `otras` son las de otros dias y viajan solo para informar: sin
    // ellas, al paciente que se equivoca de dia se le respondia "sin citas" y
    // la pantalla sugeria mandarlo a la fila de ventanilla.
    const [citas, otras] = await Promise.all([
      turnoRepository.buscarCitasPorDocumento(documento),
      turnoRepository.otrasCitasDelPaciente(documento),
    ])

    return NextResponse.json({ citas, otras })
  } catch (error) {
    return apiError(error)
  }
}

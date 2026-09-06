import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'

export async function GET() {
  try {
    await requireSeccion('/admin/pantalla')
    const configuracion = await turnoRepository.configuracion()
    return NextResponse.json({ configuracion })
  } catch (error) {
    return apiError(error)
  }
}

/** Hora del dia en formato de 24 horas, "07:00". */
const hora = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora debe tener el formato HH:MM, por ejemplo 07:00.')

const configuracionSchema = z.object({
  audioActivo: z.boolean().optional(),
  volumen: z.number().min(0).max(1).optional(),
  ultimosVisibles: z.number().int().min(3).max(10).optional(),
  mensajePie: z.string().trim().max(200).optional(),

  // --- Agenda ---
  // La duracion se acota a un rango razonable de consulta; las horas se
  // validan con forma "HH:MM" y la coherencia (cierre despues de la apertura)
  // la comprueba `guardarConfiguracion`, que es quien ve las cuatro juntas.
  duracionCitaMinutos: z.number().int().min(5).max(120).optional(),
  jornadaMananaInicio: hora.optional(),
  jornadaMananaFin: hora.optional(),
  jornadaTardeInicio: hora.optional(),
  jornadaTardeFin: hora.optional(),
})

export async function PUT(request: Request) {
  try {
    const session = await requireSeccion('/admin/pantalla')

    const body = await request.json().catch(() => null)
    const parsed = configuracionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const configuracion = await turnoRepository.guardarConfiguracion(parsed.data)

    // Cambiar las jornadas o la duracion de la consulta le mueve la agenda a
    // todo el hospital y puede dejar citas fuera de horario: tiene que quedar
    // constancia de quien lo hizo y que cambio.
    registrarEvento({
      tipo: 'CONFIGURACION_ACTUALIZADA',
      exito: true,
      usuarioId: session.user.id,
      detalle: { cambios: Object.keys(parsed.data) },
    })

    return NextResponse.json({ configuracion })
  } catch (error) {
    return apiError(error)
  }
}

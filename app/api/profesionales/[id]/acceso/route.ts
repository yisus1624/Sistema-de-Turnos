import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { nombreDeProfesional } from '@/lib/turnos/catalogo-nombres'

// 15 minutos a 72 horas: mismo rango que valida el repositorio. Se repite
// aqui para devolver un mensaje en espanol antes de tocar el dominio.
const vigenciaSchema = z.object({
  horas: z
    .number({ invalid_type_error: 'Indica las horas de vigencia.' })
    .int('Las horas deben ser un numero entero.')
    .min(0, 'Las horas no pueden ser negativas.')
    .max(72, 'La vigencia no puede pasar de 72 horas.'),
  minutos: z
    .number({ invalid_type_error: 'Indica los minutos de vigencia.' })
    .int('Los minutos deben ser un numero entero.')
    .min(0, 'Los minutos no pueden ser negativos.')
    .max(59, 'Los minutos deben estar entre 0 y 59.'),
})

/**
 * Genera el enlace temporal del profesional, con la vigencia que elige el
 * administrador (turnos de manana, tarde o noche duran distinto). Solo el
 * administrador puede generarlo; el token en claro sale UNA sola vez en esta
 * respuesta.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSeccion('/admin/enlaces')

    const body = await request.json().catch(() => null)
    const parsed = vigenciaSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const duracionMinutos = parsed.data.horas * 60 + parsed.data.minutos
    if (duracionMinutos < 15 || duracionMinutos > 72 * 60) {
      return NextResponse.json(
        { error: 'La vigencia del enlace debe estar entre 15 minutos y 72 horas.' },
        { status: 400 },
      )
    }

    const { id } = await context.params
    const { acceso, token } = await turnoRepository.crearAccesoProfesional(id, duracionMinutos)

    // Cuanto tiempo estuvo abierta esa llave, y de quien era. Sin la vigencia,
    // al revisar el registro semanas despues no se puede acotar en que ventana
    // pudo entrar alguien con ese enlace. El token NO se escribe nunca: quien
    // lea el registro no puede quedarse con la llave.
    const { ip } = await contextoPeticion()
    const doctor = (await nombreDeProfesional(id)) ?? id
    await registrarEvento({
      tipo: EVENTOS.ACCESO_PROFESIONAL_GENERADO,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: doctor,
      ip,
      detalle: { profesional: doctor, expiraEn: acceso.expiraEn, duracionMinutos },
    })

    // Url absoluta armada con el origin de la peticion: PENDIENTE DE CONFIRMACION
    // si en produccion hay proxy/dominio distinto, ese origin ya viene correcto
    // porque Next lo resuelve con las cabeceras reenviadas.
    const origin = new URL(request.url).origin
    const url = `${origin}/consultorio/${token}`

    return NextResponse.json({ url, expiraEn: acceso.expiraEn })
  } catch (error) {
    return apiError(error)
  }
}

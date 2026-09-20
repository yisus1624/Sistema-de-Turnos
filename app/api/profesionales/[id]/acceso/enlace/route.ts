/**
 * El enlace VIGENTE de un doctor, para volver a mostrarlo sin generar otro.
 *
 * POR QUE HACE FALTA. Generar uno nuevo revoca el anterior: si el doctor esta
 * a media jornada llamando pacientes, se queda fuera. Y perder el enlace es lo
 * normal en un mostrador —se borra el mensaje, lo genero el otro equipo, se
 * cerro el navegador—, asi que "regenerar" era la unica salida y costaba caro.
 *
 * QUE SE PUEDE Y QUE NO. El repositorio solo devuelve el token si el acceso
 * sigue vivo: ni revocado, ni vencido. Un enlace muerto no se puede mostrar
 * por ninguna via, y ademas su copia cifrada se borra al pasar por aqui.
 *
 * Cada consulta deja rastro: el enlace abre la agenda con nombres de pacientes
 * sin pedir contrasena, asi que quien pudo tenerlo en la mano forma parte de la
 * respuesta a "¿quien entro a ese consultorio?".
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { nombreDeProfesional } from '@/lib/turnos/catalogo-nombres'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // La misma seccion que ya permite generar y revocar: quien puede crear un
    // enlace valido con un clic no gana nada nuevo pudiendo ver el que existe,
    // y en cambio deja de tener que tumbar el del doctor para conseguirlo.
    const session = await requireSeccion('/admin/enlaces')

    const { id } = await context.params
    const token = await turnoRepository.tokenVigenteDeProfesional(id)

    if (!token) {
      return NextResponse.json(
        { error: 'Este profesional no tiene un enlace vigente que se pueda mostrar.' },
        { status: 404 },
      )
    }

    const { ip } = await contextoPeticion()
    const doctor = (await nombreDeProfesional(id)) ?? id
    // El token NO se escribe en el registro: quien lea el registro no puede
    // quedarse con la llave. Es la misma regla que al generarlo.
    await registrarEvento({
      tipo: EVENTOS.ACCESO_PROFESIONAL_CONSULTADO,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: doctor,
      ip,
      detalle: { profesional: doctor },
    })

    // Url absoluta armada con el origin de la peticion, igual que al generarlo.
    const origin = new URL(request.url).origin
    return NextResponse.json({ url: `${origin}/consultorio/${token}` })
  } catch (error) {
    return apiError(error)
  }
}

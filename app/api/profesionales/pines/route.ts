/**
 * Los PIN de los medicos, para la pantalla "PIN de medicos" del administrador.
 *
 * Trae el PIN en claro: el hospital quiere que el administrador lo pueda
 * volver a ver para dictarselo al medico que lo olvido. Por eso la consulta
 * queda apuntada en el registro de actividad, como la de un enlace.
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await requireSeccion('/admin/pines')
    const [profesionales, modulos, pines, configuracion] = await Promise.all([
      turnoRepository.listarProfesionales(undefined, true),
      turnoRepository.listarModulos(undefined, true),
      turnoRepository.listarPines(),
      turnoRepository.configuracion(),
    ])
    const pinDe = new Map(pines.map((pin) => [pin.profesionalId, pin]))
    const consultorioDe = new Map(modulos.map((modulo) => [modulo.id, modulo.nombre]))

    await registrarEvento({
      tipo: EVENTOS.PIN_CONSULTADO,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: session.user.usuario,
      ip: (await contextoPeticion()).ip,
    })

    return NextResponse.json({
      modo: configuracion.accesoProfesionales,
      medicos: profesionales
        .map((profesional) => ({
          profesionalId: profesional.id,
          nombre: profesional.nombre,
          activo: profesional.activo,
          jornada: profesional.jornada,
          consultorio: profesional.moduloId ? (consultorioDe.get(profesional.moduloId) ?? null) : null,
          pin: pinDe.get(profesional.id) ?? null,
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    })
  } catch (error) {
    return apiError(error)
  }
}

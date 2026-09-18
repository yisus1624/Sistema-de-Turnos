/**
 * Agenda de citas.
 *
 * TEMPORAL: en produccion las citas las trae la API del hospital. Esta ruta
 * permite listarlas y cargarlas a mano durante el demo. El documento y el
 * nombre del paciente solo se manejan aqui, en pantallas CON sesion.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'

export async function GET(request: Request) {
  try {
    await requireSeccion('/admin/citas', '/operador/agenda', '/admin/pruebas')

    const { searchParams } = new URL(request.url)
    const citas = await turnoRepository.listarCitas({
      fecha: searchParams.get('fecha') ?? undefined,
      profesionalId: searchParams.get('profesionalId') ?? undefined,
    })
    return NextResponse.json({ citas })
  } catch (error) {
    return apiError(error)
  }
}

const citaSchema = z.object({
  documentoPaciente: z.string().trim().min(4, 'Ingresa al menos 4 digitos del documento.').max(20),
  nombrePaciente: z.string().trim().min(3, 'Ingresa el nombre del paciente.').max(80),
  profesionalId: z.string().min(1, 'Selecciona el profesional.'),
  horaCita: z.string().min(1, 'Indica la hora de la cita.'),
})

export async function POST(request: Request) {
  try {
    const session = await requireSeccion('/admin/citas', '/operador/agenda', '/admin/pruebas')

    const body = await request.json().catch(() => null)
    const parsed = citaSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const cita = await turnoRepository.crearCita({ ...parsed.data, usuarioId: session.user.id })

    await registrarEvento({
      tipo: EVENTOS.CITA_CREADA,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: cita.documentoPaciente,
      detalle: { citaId: cita.id, horaCita: cita.horaCita, profesionalId: cita.profesionalId },
    })

    return NextResponse.json({ cita })
  } catch (error) {
    return apiError(error)
  }
}

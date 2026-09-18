import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion, tieneSeccion } from '@/lib/permissions/session'
import type { EstadoTurno } from '@/lib/turnos/types'

const ESTADOS: EstadoTurno[] = ['EN_ESPERA', 'LLAMADO', 'EN_ATENCION', 'ATENDIDO', 'AUSENTE', 'CANCELADO']

export async function GET(request: Request) {
  try {
    // POR SECCION, no por rol. Es lo que usa el resto del sistema, y la
    // diferencia importa: con `requireRol` un operador cuyas secciones ya no
    // incluyen ninguna pantalla de turnos seguia entrando y recibiendo un 200.
    // No llegaba a ver nada ajeno —abajo se le fija el filtro a lo que el mismo
    // llamo, y el turno no lleva datos del paciente—, pero una seccion retirada
    // tiene que responder 403, no lista vacia: si no, el dia que se reabra
    // alguna, nadie sabe quien podia entrar realmente.
    const session = await requireSeccion(
      '/admin/turnos',
      '/admin/historico',
      '/admin/reportes',
      '/operador',
      '/operador/historico',
    )
    const { searchParams } = new URL(request.url)

    const estado = searchParams.get('estado')
    // Quien tiene el monitor en vivo, el historico o los reportes ve TODOS los
    // turnos y puede filtrar por funcionario (requerimiento seccion 18). Quien
    // solo tiene su propio historico ve unicamente lo que el mismo llamo.
    //
    // '/admin/turnos' entra en la lista porque el monitor en vivo cuenta lo que
    // esta pasando ahora mismo en toda la sala, y los turnos los llaman los
    // medicos desde su consultorio, no el administrador: filtrarlos por quien
    // consulta dejaba los indicadores en cero.
    const veTodo = tieneSeccion(session, '/admin/turnos', '/admin/historico', '/admin/reportes')
    const funcionarioId = veTodo ? (searchParams.get('funcionarioId') ?? undefined) : session.user.id

    const turnos = await turnoRepository.historico({
      fecha: searchParams.get('fecha') ?? undefined,
      fechaDesde: searchParams.get('fechaDesde') ?? undefined,
      fechaHasta: searchParams.get('fechaHasta') ?? undefined,
      servicioId: searchParams.get('servicioId') ?? undefined,
      codigo: searchParams.get('codigo') ?? undefined,
      moduloId: searchParams.get('moduloId') ?? undefined,
      estado: estado && ESTADOS.includes(estado as EstadoTurno) ? (estado as EstadoTurno) : undefined,
      funcionarioId,
    })

    return NextResponse.json({ turnos })
  } catch (error) {
    return apiError(error)
  }
}

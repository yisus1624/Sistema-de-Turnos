import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol, tieneSeccion } from '@/lib/permissions/session'
import type { EstadoTurno } from '@/lib/turnos/types'

const ESTADOS: EstadoTurno[] = ['EN_ESPERA', 'LLAMADO', 'EN_ATENCION', 'ATENDIDO', 'AUSENTE', 'CANCELADO']

export async function GET(request: Request) {
  try {
    const session = await requireRol(['OPERADOR', 'ADMINISTRADOR'])
    const { searchParams } = new URL(request.url)

    const estado = searchParams.get('estado')
    // Quien tiene el historico o los reportes de administracion ve todos los
    // turnos y puede filtrar por funcionario (requerimiento seccion 18). El
    // operador que solo tiene su propio historico ve unicamente lo que el
    // mismo llamo.
    const veTodo = tieneSeccion(session, '/admin/historico', '/admin/reportes')
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

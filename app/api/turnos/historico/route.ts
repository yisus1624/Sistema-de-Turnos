import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'
import type { EstadoTurno } from '@/lib/turnos/types'

const ESTADOS: EstadoTurno[] = ['EN_ESPERA', 'LLAMADO', 'EN_ATENCION', 'ATENDIDO', 'AUSENTE', 'CANCELADO']

export async function GET(request: Request) {
  try {
    const session = await requireRol(['OPERADOR', 'ADMINISTRADOR'])
    const { searchParams } = new URL(request.url)

    const estado = searchParams.get('estado')
    // El operador solo consulta lo que el mismo llamo; el administrador ve todo
    // y puede filtrar por funcionario (requerimiento seccion 18).
    const funcionarioId =
      session.user.rol === 'ADMINISTRADOR'
        ? (searchParams.get('funcionarioId') ?? undefined)
        : session.user.id

    const turnos = await turnoRepository.historico({
      fecha: searchParams.get('fecha') ?? undefined,
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

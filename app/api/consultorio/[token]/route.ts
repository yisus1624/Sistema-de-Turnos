import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { errorConsultorio, requireProfesionalPorToken } from '@/lib/turnos/acceso-consultorio'

/**
 * Estado inicial de la pantalla del doctor: quien es, sus consultorios
 * posibles (el suyo por defecto) y sus pacientes en espera.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params
    const profesional = await requireProfesionalPorToken(token)

    const [modulos, pendientes, turnoActual] = await Promise.all([
      turnoRepository.listarModulos(profesional.servicioId),
      turnoRepository.listarPendientes({ profesionalId: profesional.id }),
      buscarTurnoEnAtencion(profesional.id),
    ])

    return NextResponse.json({ profesional, modulos, pendientes, turnoActual })
  } catch (error) {
    return errorConsultorio(error)
  }
}

/**
 * El turno "en atencion ahora" no vive como tal en el repositorio: se infiere
 * del ultimo turno LLAMADO/EN_ATENCION del profesional, para que si el
 * doctor recarga la pagina no pierda de vista a quien tiene al frente.
 */
async function buscarTurnoEnAtencion(profesionalId: string) {
  const historico = await turnoRepository.historico({ profesionalId })
  return (
    historico.find((t) => t.estado === 'LLAMADO' || t.estado === 'EN_ATENCION') ?? null
  )
}

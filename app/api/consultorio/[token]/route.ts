import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { errorConsultorio, requireProfesionalPorToken } from '@/lib/turnos/acceso-consultorio'

/** Fecha de hoy en Colombia, en formato AAAA-MM-DD (mismo criterio que estadisticas). */
function hoyEnColombia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

/**
 * Estado inicial de la pantalla del doctor: quien es, sus consultorios
 * posibles (el suyo por defecto), sus pacientes en espera y su AGENDA del
 * dia completa (con o sin llegada registrada), para que entienda por que un
 * paciente todavia no aparece para llamar.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params
    const profesional = await requireProfesionalPorToken(token)

    const url = new URL(request.url)
    const fecha = url.searchParams.get('fecha') || hoyEnColombia()

    const [modulos, pendientes, turnoActual, agenda] = await Promise.all([
      turnoRepository.listarModulos(profesional.servicioId),
      turnoRepository.listarPendientes({ profesionalId: profesional.id }),
      buscarTurnoEnAtencion(profesional.id),
      turnoRepository.agendaProfesional(profesional.id, fecha),
    ])

    return NextResponse.json({ profesional, modulos, pendientes, turnoActual, agenda, fecha })
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

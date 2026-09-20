import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { errorConsultorio, requireProfesionalDelConsultorio } from '@/lib/turnos/acceso-consultorio'

/** Fecha de hoy en Colombia, en formato AAAA-MM-DD (mismo criterio que estadisticas). */
function hoyEnColombia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

/**
 * Estado inicial de la pantalla del doctor: quien es, sus consultorios
 * posibles (el suyo por defecto), sus pacientes en espera y su AGENDA del
 * dia completa (con o sin llegada registrada), para que entienda por que un
 * paciente todavia no aparece para llamar.
 *
 * Esta pantalla se refresca sola cada pocos segundos y hay una abierta por
 * consultorio, asi que es de las rutas mas repetidas del sistema: las cuatro
 * consultas van en paralelo y ninguna construye el historico entero.
 */
export async function GET(request: Request) {
  try {
    const profesional = await requireProfesionalDelConsultorio(request)

    const url = new URL(request.url)
    const fecha = url.searchParams.get('fecha') || hoyEnColombia()

    // El paciente que tiene enfrente es SIEMPRE el de hoy, aunque este mirando
    // la agenda de otro dia. Antes se buscaba con la `fecha` consultada: al
    // revisar la agenda de mañana, el turno en atencion se volvia null,
    // desaparecia la tarjeta del paciente y se le apagaban los botones de
    // "Atendido", "Ausente" y "Repetir" con el paciente todavia sentado ahi.
    const [modulos, pendientes, turnoActual, agenda] = await Promise.all([
      turnoRepository.listarModulos(profesional.servicioId),
      turnoRepository.listarPendientes({ profesionalId: profesional.id }),
      turnoRepository.turnoEnAtencion(profesional.id, hoyEnColombia()),
      turnoRepository.agendaProfesional(profesional.id, fecha),
    ])

    return NextResponse.json({ profesional, modulos, pendientes, turnoActual, agenda, fecha })
  } catch (error) {
    return errorConsultorio(error)
  }
}

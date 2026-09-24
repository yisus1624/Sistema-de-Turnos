import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { errorConsultorio, requireProfesionalDelConsultorio } from '@/lib/turnos/acceso-consultorio'
import { diaColombia } from '@/lib/turnos/tiempo'


/**
 * Estado de la pantalla del doctor: quien es, SU consultorio y su
 * especialidad, sus pacientes en espera y su AGENDA del dia completa (con o
 * sin llegada registrada), para que entienda por que un paciente todavia no
 * aparece para llamar.
 *
 * El consultorio NO se elige: es el que trae asignado en la agenda que carga
 * el hospital. Antes habia un selector, y un doctor que lo tocaba sin querer
 * llamaba a sus pacientes a la puerta de otro.
 *
 * Esta pantalla se refresca sola cada pocos segundos y hay una abierta por
 * consultorio, asi que es de las rutas mas repetidas del sistema: las cuatro
 * consultas van en paralelo y ninguna construye el historico entero.
 */
export async function GET(request: Request) {
  try {
    const profesional = await requireProfesionalDelConsultorio(request)

    const url = new URL(request.url)
    const hoy = diaColombia(new Date())
    const fecha = url.searchParams.get('fecha') || hoy

    // El paciente que tiene enfrente es SIEMPRE el de hoy, aunque este mirando
    // la agenda de otro dia. Antes se buscaba con la `fecha` consultada: al
    // revisar la agenda de mañana, el turno en atencion se volvia null,
    // desaparecia la tarjeta del paciente y se le apagaban los botones de
    // "Atendido", "Ausente" y "Repetir" con el paciente todavia sentado ahi.
    //
    // `retroceso` es lo que haria el boton "Retroceder" ahora mismo: la
    // pantalla lo muestra antes de confirmar y lo devuelve al pulsar, para que
    // el servidor solo haga ESE retroceso.
    const [modulos, servicios, pendientes, turnoActual, agenda, retroceso] = await Promise.all([
      // Todos, activos o no: el consultorio del doctor puede ser de otro
      // servicio ("consultorio general") y aun asi hay que decir cual es.
      turnoRepository.listarModulos(undefined, true),
      turnoRepository.listarServicios(true),
      turnoRepository.listarPendientes({ profesionalId: profesional.id }),
      turnoRepository.turnoAbierto({ profesionalId: profesional.id }, hoy),
      turnoRepository.agendaProfesional(profesional.id, fecha),
      turnoRepository.planDeRetroceso(profesional.id),
    ])

    const consultorio = modulos.find((m) => m.id === profesional.moduloId) ?? null
    const servicio = servicios.find((s) => s.id === profesional.servicioId) ?? null

    return NextResponse.json({ profesional, consultorio, servicio, pendientes, turnoActual, agenda, retroceso, fecha })
  } catch (error) {
    return errorConsultorio(error)
  }
}

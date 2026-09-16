/**
 * Las jornadas de los doctores: consultar las de un dia y recalcular la
 * habitual a partir de un periodo.
 *
 * SON DOS COSAS DISTINTAS Y POR ESO SON DOS VERBOS.
 *
 * `GET` responde que trabajo cada doctor UN DIA concreto, deducido de las
 * citas de ese dia. No guarda nada ni cambia nada: es la trazabilidad, y se
 * puede preguntar por cualquier dia que ya este cargado. El mismo medico hace
 * el lunes completo, el martes solo la mañana y el miercoles no viene.
 *
 * `POST` recalcula la jornada HABITUAL de la ficha —la que se usa para
 * agendarle el primer paciente de un dia que todavia esta vacio— mirando el
 * periodo que se le diga. Eso si escribe, y por eso deja rastro.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { recalcularJornadas } from '@/lib/citas/jornadas'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { diaColombia, ahoraISO, esFechaValida } from '@/lib/turnos/tiempo'

const periodo = z.object({
  desde: z.string().refine(esFechaValida, 'La fecha inicial no es valida.').optional(),
  hasta: z.string().refine(esFechaValida, 'La fecha final no es valida.').optional(),
})

export async function GET(request: Request) {
  try {
    await requireSeccion('/admin/profesionales')

    const pedida = new URL(request.url).searchParams.get('fecha')
    if (pedida && !esFechaValida(pedida)) {
      return NextResponse.json({ error: 'La fecha no es valida.' }, { status: 400 })
    }
    const fecha = pedida ?? diaColombia(ahoraISO())

    return NextResponse.json({ fecha, jornadas: await turnoRepository.jornadasDelDia(fecha) })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSeccion('/admin/profesionales')

    // El cuerpo es opcional: sin el se miran los ultimos 30 dias, que es lo que
    // hacia antes de que se pudiera elegir el periodo.
    const crudo = await request.text()
    const parsed = periodo.safeParse(crudo ? JSON.parse(crudo) : {})
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
    }

    const { desde, hasta } = parsed.data
    if (Boolean(desde) !== Boolean(hasta)) {
      return NextResponse.json(
        { error: 'Indica las dos fechas del periodo, o ninguna.' },
        { status: 400 },
      )
    }

    const resumen = await recalcularJornadas({ desde, hasta })

    // Cambiarle la jornada habitual a un doctor cambia a que horas se le puede
    // agendar el primer paciente del dia. Tiene que quedar quien lo pidio,
    // sobre que periodo, y el antes y el despues de cada uno: con solo el
    // despues no se puede deshacer a mano lo que salio mal.
    const { ip } = await contextoPeticion()
    registrarEvento({
      tipo: 'profesionales.jornadas.recalculadas',
      exito: true,
      usuarioId: session.user.id,
      ip,
      detalle: {
        periodo: `${resumen.desde} a ${resumen.hasta}`,
        diasMirados: resumen.diasMirados,
        doctoresRevisados: resumen.doctoresRevisados,
        ajustes: resumen.ajustes.map((a) => `${a.nombre}: ${a.anterior} -> ${a.jornada}`),
      },
    })

    return NextResponse.json(resumen)
  } catch (error) {
    return apiError(error)
  }
}

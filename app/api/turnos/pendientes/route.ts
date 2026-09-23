import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { diaColombia } from '@/lib/turnos/tiempo'
import { idSchema } from '@/lib/validators/turnos'

/**
 * Solo filas COMPARTIDAS (ventanillas). Ya no acepta `profesionalId`: la
 * fila de un doctor, con los nombres de sus pacientes, solo la ve el doctor
 * por su enlace.
 */
const consultaSchema = z.object({
  servicioId: idSchema,
  moduloId: idSchema.optional(),
})

/** Los parametros presentes de la consulta; los vacios no cuentan. */
function leerConsulta(url: string) {
  const presentes = [...new URL(url).searchParams].filter(([, valor]) => valor !== '')
  return consultaSchema.safeParse(Object.fromEntries(presentes))
}

async function esFilaCompartida(servicioId: string): Promise<boolean> {
  const servicio = (await turnoRepository.listarServicios()).find((s) => s.id === servicioId)
  return servicio?.modoFila === 'COMPARTIDA'
}

/**
 * La ventanilla tiene que ser de ese servicio (o generica).
 *
 * Con cualquier `moduloId`, la pantalla del operador podia pedir —y luego
 * cerrar— el turno abierto de un modulo que no le corresponde.
 */
async function ventanillaDelServicio(moduloId: string, servicioId: string): Promise<boolean> {
  const modulo = (await turnoRepository.listarModulos()).find((m) => m.id === moduloId)
  return Boolean(modulo && (!modulo.servicioId || modulo.servicioId === servicioId))
}

export async function GET(request: Request) {
  try {
    const session = await requireSeccion('/operador')

    const parsed = leerConsulta(request.url)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Debes indicar el servicio de la ventanilla.' }, { status: 400 })
    }

    const { servicioId, moduloId } = parsed.data
    if (!(await esFilaCompartida(servicioId))) {
      return NextResponse.json({ error: 'Ese servicio atiende por cita: su fila la ve cada profesional.' }, { status: 400 })
    }
    if (moduloId && !(await ventanillaDelServicio(moduloId, servicioId))) {
      return NextResponse.json({ error: 'Esa ventanilla no corresponde al servicio elegido.' }, { status: 400 })
    }

    // Con la ventanilla indicada se devuelve tambien el turno que ESTE
    // funcionario tiene abierto ahi: es la forma de recuperarlo si se perdio la
    // respuesta del llamado o se recargo la pagina. Solo el suyo: el de otro
    // funcionario en la misma ventanilla no es suyo para cerrar.
    const [pendientes, turnoActual] = await Promise.all([
      turnoRepository.listarPendientes({ servicioId }),
      moduloId
        ? turnoRepository.turnoAbierto({ moduloId, funcionarioId: session.user.id }, diaColombia(new Date()))
        : null,
    ])
    return NextResponse.json({ pendientes, turnoActual })
  } catch (error) {
    return apiError(error)
  }
}

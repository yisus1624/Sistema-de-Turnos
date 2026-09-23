import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion, tieneSeccion } from '@/lib/permissions/session'
import { contextoPeticion } from '@/lib/seguridad/registro'
import { conFrenoDeConsultaPesada } from '@/lib/seguridad/freno-consultas'
import { acotarRangoDelHistorico, MAXIMO_FILAS_HISTORICO } from '@/lib/turnos/rango-historico'
import { diaColombia } from '@/lib/turnos/tiempo'
import { ESTADOS_TURNO } from '@/lib/turnos/types'

/**
 * Los filtros vienen de la URL: se validan aqui, con topes, antes de tocar el
 * repositorio. Los identificadores son cuid (25 caracteres) y un codigo de
 * turno es corto ("C-010"); lo que pase de eso no es una busqueda de verdad.
 */
const identificador = z.string().trim().min(1).max(64).optional()
const filtrosSchema = z.object({
  servicioId: identificador,
  moduloId: identificador,
  funcionarioId: identificador,
  codigo: z.string().trim().min(1).max(20).optional(),
  estado: z.enum(ESTADOS_TURNO).optional(),
})

/** Los filtros de la URL; los vacios cuentan como no puestos. */
function filtrosDe(searchParams: URLSearchParams) {
  const leer = (clave: string) => searchParams.get(clave) || undefined
  return filtrosSchema.safeParse({
    servicioId: leer('servicioId'),
    moduloId: leer('moduloId'),
    funcionarioId: leer('funcionarioId'),
    codigo: leer('codigo'),
    estado: leer('estado'),
  })
}

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
    const filtros = filtrosDe(searchParams)
    if (!filtros.success) {
      return NextResponse.json({ error: 'Algun filtro no es valido. Revisa el turno, el estado o el servicio.' }, { status: 400 })
    }
    const { estado, servicioId, moduloId, codigo } = filtros.data
    // Quien tiene el monitor en vivo, el historico o los reportes ve TODOS los
    // turnos y puede filtrar por funcionario (requerimiento seccion 18). Quien
    // solo tiene su propio historico ve unicamente lo que el mismo llamo.
    //
    // '/admin/turnos' entra en la lista porque el monitor en vivo cuenta lo que
    // esta pasando ahora mismo en toda la sala, y los turnos los llaman los
    // medicos desde su consultorio, no el administrador: filtrarlos por quien
    // consulta dejaba los indicadores en cero.
    const veTodo = tieneSeccion(session, '/admin/turnos', '/admin/historico', '/admin/reportes')
    const funcionarioId = veTodo ? filtros.data.funcionarioId : session.user.id

    // Sin fechas, hoy; un rango, como mucho un trimestre (ver `rango-historico`).
    const rango = acotarRangoDelHistorico(
      {
        fecha: searchParams.get('fecha') || undefined,
        fechaDesde: searchParams.get('fechaDesde') || undefined,
        fechaHasta: searchParams.get('fechaHasta') || undefined,
      },
      diaColombia(new Date()),
    )

    const { ip } = await contextoPeticion()
    // Una fila de mas para saber si hay mas de las que se devuelven.
    const filas = await conFrenoDeConsultaPesada('historico', { usuarioId: session.user.id, ip }, () =>
      turnoRepository.historico({
        ...rango,
        servicioId,
        codigo,
        moduloId,
        estado,
        funcionarioId,
        limite: MAXIMO_FILAS_HISTORICO + 1,
      }),
    )

    const truncado = filas.length > MAXIMO_FILAS_HISTORICO
    return NextResponse.json({ turnos: filas.slice(0, MAXIMO_FILAS_HISTORICO), truncado })
  } catch (error) {
    return apiError(error)
  }
}

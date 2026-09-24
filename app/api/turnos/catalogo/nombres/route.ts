import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { soloNombres } from '@/lib/turnos/nombres-de-respaldo'

/**
 * Nombres (solo id y nombre) de TODO el catalogo, inactivos incluidos, en solo
 * lectura.
 *
 * Reportes, Historico y Turnos en curso ponian "—" a los turnos de un servicio,
 * consultorio o medico ya desactivado: sus listas solo traen los activos. Se
 * expone lo minimo para poner el nombre, y solo a quien ve esas pantallas.
 */
export async function GET() {
  try {
    await requireSeccion('/admin/reportes', '/admin/historico', '/operador/historico', '/admin/turnos')
    const [servicios, modulos, profesionales] = await Promise.all([
      turnoRepository.listarServicios(true),
      turnoRepository.listarModulos(undefined, true),
      turnoRepository.listarProfesionales(undefined, true),
    ])
    return NextResponse.json({
      servicios: soloNombres(servicios),
      modulos: soloNombres(modulos),
      profesionales: soloNombres(profesionales),
    })
  } catch (error) {
    return apiError(error)
  }
}

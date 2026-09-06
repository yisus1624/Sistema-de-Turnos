/**
 * Busqueda de citas del dia por documento, para que admisiones registre la
 * llegada del paciente.
 *
 * El documento del paciente solo se usa aqui, en una pantalla CON sesion.
 * Nunca sale hacia la pantalla de la sala de espera.
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'

export async function GET(request: Request) {
  try {
    await requireSeccion('/operador/admisiones', '/admin/citas', '/admin/pruebas')

    const { searchParams } = new URL(request.url)
    const documento = searchParams.get('documento')?.trim() ?? ''
    if (documento.length < 4) {
      return NextResponse.json({ error: 'Ingresa al menos 4 digitos del documento.' }, { status: 400 })
    }

    // `citas` son las de HOY, las unicas a las que se les puede registrar la
    // llegada. `otras` son las de otros dias y viajan solo para informar: sin
    // ellas, al paciente que se equivoca de dia se le respondia "sin citas" y
    // la pantalla sugeria mandarlo a la fila de ventanilla.
    const [citas, otras] = await Promise.all([
      turnoRepository.buscarCitasPorDocumento(documento),
      turnoRepository.otrasCitasDelPaciente(documento),
    ])

    return NextResponse.json({ citas, otras })
  } catch (error) {
    return apiError(error)
  }
}

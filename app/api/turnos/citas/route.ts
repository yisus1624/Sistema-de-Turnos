/**
 * Busqueda de citas del dia por documento, para que admisiones registre la
 * llegada del paciente.
 *
 * El documento del paciente solo se usa aqui, en una pantalla CON sesion.
 * Nunca sale hacia la pantalla de la sala de espera.
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'
import { apiError, requireRol } from '@/lib/permissions/session'

export async function GET(request: Request) {
  try {
    await requireRol(['OPERADOR', 'ADMINISTRADOR'])

    const { searchParams } = new URL(request.url)
    const documento = searchParams.get('documento')?.trim() ?? ''
    if (documento.length < 4) {
      return NextResponse.json({ error: 'Ingresa al menos 4 digitos del documento.' }, { status: 400 })
    }

    const citas = await turnoRepository.buscarCitasPorDocumento(documento)
    return NextResponse.json({ citas })
  } catch (error) {
    return apiError(error)
  }
}

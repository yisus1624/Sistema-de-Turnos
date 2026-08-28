// Publico a proposito: lo consume el televisor de la sala de espera, que no
// inicia sesion (requerimiento seccion 6.3). El repositorio ya devuelve el
// nombre del paciente enmascarado.
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/in-memory-repository'

export const dynamic = 'force-dynamic'

export async function GET() {
  const configuracion = await turnoRepository.configuracion()
  const [casillas, ultimos] = await Promise.all([
    turnoRepository.estadoPantalla(),
    turnoRepository.ultimosLlamados(configuracion.ultimosVisibles),
  ])

  return NextResponse.json({ casillas, ultimos, configuracion })
}

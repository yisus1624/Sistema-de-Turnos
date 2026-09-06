// Publico a proposito: lo consume el televisor de la sala de espera, que no
// inicia sesion (requerimiento seccion 6.3). Nada de lo que sale por aqui lleva
// datos del paciente: `CasillaPantalla` solo tiene el turno, el consultorio y
// el doctor.
//
// Es la ruta mas pedida del sistema (el televisor se resincroniza solo, y el
// monitor del administrador la consulta cada pocos segundos), asi que no
// calcula nada que nadie use.
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Antes tambien se calculaban y enviaban los "ultimos llamados", para una
  // lista lateral que el rediseño de la pantalla quito: eran una ordenacion de
  // todos los turnos del dia, en cada peticion, para un dato que ya no lee
  // nadie. `ultimosLlamados` sigue en el repositorio por si esa lista vuelve.
  const [casillas, configuracion] = await Promise.all([
    turnoRepository.estadoPantalla(),
    turnoRepository.configuracion(),
  ])

  return NextResponse.json({ casillas, configuracion })
}

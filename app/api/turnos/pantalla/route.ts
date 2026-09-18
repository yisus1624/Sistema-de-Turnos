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
  // UNA sola llamada al repositorio. Antes se pedia aparte la configuracion,
  // que `estadoPantalla` ya habia cargado por dentro: la misma fila leida dos
  // veces en cada refresco de cada televisor encendido.
  const { casillas, configuracion } = await turnoRepository.estadoPantalla()

  return NextResponse.json({ casillas, configuracion })
}

// Publico a proposito: lo consume el televisor de la sala de espera, que no
// inicia sesion (requerimiento seccion 6.3). Nada de lo que sale por aqui lleva
// datos del paciente: `CasillaPantalla` solo tiene el turno, el consultorio y
// el doctor.
//
// Es la ruta mas pedida del sistema (el televisor se resincroniza solo, y el
// monitor del administrador la consulta cada pocos segundos), asi que no
// calcula nada que nadie use.
import { NextResponse } from 'next/server'
import { esPeticionDeDemostracion, mundoDeDemostracion } from '@/lib/demostracion/mundo'
import { estadoPantallaCacheado } from '@/lib/turnos/pantalla-cacheada'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Un navegador con la sesion de demostracion ve la sala de la demostracion,
  // marcada como tal (`demostracion: true`) para que el televisor lo diga en
  // grande. Un televisor sin sesion no paga nada por esta pregunta: sin
  // cookie de sesion ni siquiera se lee (ver `esPeticionDeDemostracion`).
  if (await esPeticionDeDemostracion()) {
    const { casillas, configuracion } = await mundoDeDemostracion().repositorio.estadoPantalla()
    return NextResponse.json({ casillas, configuracion, ahora: new Date().toISOString(), demostracion: true })
  }

  // UNA sola llamada al repositorio. Antes se pedia aparte la configuracion,
  // que `estadoPantalla` ya habia cargado por dentro: la misma fila leida dos
  // veces en cada refresco de cada televisor encendido.
  //
  // Y con cache de segundo y medio, que se tira sola en cuanto el canal en
  // vivo publica algo: sin ella, un bucle de peticiones contra esta ruta
  // —publica y sin sesion— agota el pool de Prisma, que es el mismo del inicio
  // de sesion. El porque completo esta en `lib/turnos/pantalla-cacheada.ts`.
  const { casillas, configuracion } = await estadoPantallaCacheado()

  // La hora del servidor viaja con la foto: el televisor decide con ella que
  // llamados son recientes, no con su propio reloj, que puede ir descuadrado.
  return NextResponse.json({ casillas, configuracion, ahora: new Date().toISOString() })
}

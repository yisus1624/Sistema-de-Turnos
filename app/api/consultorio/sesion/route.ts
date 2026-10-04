/**
 * "Cambiar de medico": el que estaba sale de este equipo y la pantalla vuelve
 * al PIN, para que entre el siguiente.
 *
 * Vive bajo `/api/consultorio` porque la cookie del medico solo viaja a esa
 * ruta (ver `proxy.ts`). Se borra en este navegador; el acceso en si vence
 * solo al final de su jornada (ver `minutosDeSesion`), y como nadie mas tiene
 * esa cookie, ya no lo usa nadie.
 *
 * Responde 401 si no habia un medico dentro (como el resto de rutas del
 * consultorio), pero la cookie se borra igual: salir nunca puede fallar.
 */
import { NextResponse } from 'next/server'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { COOKIE_CONSULTORIO, tokenDeLaPeticion } from '@/lib/turnos/acceso-consultorio'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request) {
  const token = tokenDeLaPeticion(request)
  const habiaMedico = token ? Boolean(await turnoRepository.validarAccesoProfesional(token).catch(() => null)) : false

  const respuesta = habiaMedico
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'No habia ningun medico dentro en este equipo.' }, { status: 401 })
  respuesta.cookies.set(COOKIE_CONSULTORIO, '', { path: '/api/consultorio', maxAge: 0 })
  return respuesta
}

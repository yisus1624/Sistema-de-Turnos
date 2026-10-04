/**
 * El medico entra a su consultorio con su PIN de 6 digitos.
 *
 * El PIN solo ya dice quien es: no hay que elegir el nombre ni autorizar el
 * equipo. Solo funciona si el administrador eligio la entrada con PIN
 * (`accesoProfesionales`, en Ajustes).
 *
 * Al acertar, se le abre al medico el mismo acceso que daba el enlace —un
 * token de consultorio en su cookie—, que dura hasta el final de su jornada
 * (ver `minutosDeSesion`). Asi la pantalla del consultorio no cambia en nada.
 *
 * LOS FRENOS estan explicados en `lib/consultorio/freno-pin.ts`.
 *
 * LA DEMOSTRACION. Se busca primero entre los medicos reales y, si no esta,
 * entre los de prueba: asi se muestra el sistema escribiendo el PIN de un
 * medico de mentira, sin preparar nada. Cada hospital mira su propio modo de
 * entrada, y un PIN de prueba solo abre pacientes inventados (ver
 * `lib/demostracion/mundo.ts`).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { enMundo, MUNDO_REAL, mundoDeDemostracion, type Mundo } from '@/lib/demostracion/mundo'
import { turnoRepository } from '@/lib/turnos/repositorio'
import {
  COOKIE_ENTRADA,
  COOKIE_NAVEGADOR,
  ENTRADA_DE_MEDICO,
  FALLOS_POR_CONEXION,
  FALLOS_POR_NAVEGADOR,
  MS_BLOQUEO_CONEXION,
  MS_BLOQUEO_NAVEGADOR,
  navegadorDeLaPeticion,
  opcionesDeCookieDeFreno,
} from '@/lib/consultorio/freno-pin'
import { minutosDeSesion } from '@/lib/consultorio/sesion-pin'
import { COOKIE_CONSULTORIO } from '@/lib/turnos/acceso-consultorio'
import { esPinValido } from '@/lib/turnos/reglas-pin'
import { permitePin, type Profesional } from '@/lib/turnos/types'
import { apiError } from '@/lib/permissions/session'
import { apuntarFallo, fallosVigentes, limpiarIntentos, superaFallos } from '@/lib/seguridad/limitador'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'

export const dynamic = 'force-dynamic'

const pinSchema = z.object({ pin: z.string().trim() })

const POR_NAVEGADOR = 'pin_por_navegador'
const POR_CONEXION = 'pin_por_conexion'

function bloqueado(minutos: number) {
  return NextResponse.json(
    { error: `Demasiados intentos. Espera ${minutos} minutos y vuelve a intentarlo.` },
    { status: 429 },
  )
}

/** Los hospitales que hoy dejan entrar con PIN: el real y, aparte, el de prueba. */
async function mundosConPin(): Promise<Mundo[]> {
  const mundos: Mundo[] = []
  for (const mundo of [MUNDO_REAL, mundoDeDemostracion()]) {
    const { accesoProfesionales } = await enMundo(mundo, () => turnoRepository.configuracion())
    if (permitePin(accesoProfesionales)) mundos.push(mundo)
  }
  return mundos
}

/** El medico de ese PIN y su mundo: primero el hospital real, luego el de prueba. */
async function buscar(pin: string, mundos: Mundo[]): Promise<{ profesional: Profesional; mundo: Mundo } | null> {
  for (const mundo of mundos) {
    const profesional = await enMundo(mundo, () => turnoRepository.profesionalPorPin(pin))
    if (profesional) return { profesional, mundo }
  }
  return null
}

export async function POST(request: Request) {
  try {
    const mundos = await mundosConPin()
    if (mundos.length === 0) {
      return NextResponse.json(
        { error: 'El hospital no esta usando la entrada con PIN. Usa el enlace que te envian.' },
        { status: 403 },
      )
    }

    const navegador = navegadorDeLaPeticion(request)
    const { ip } = await contextoPeticion()
    if (superaFallos(POR_NAVEGADOR, navegador.id, FALLOS_POR_NAVEGADOR)) return bloqueado(MS_BLOQUEO_NAVEGADOR / 60000)
    if (ip && superaFallos(POR_CONEXION, ip, FALLOS_POR_CONEXION)) return bloqueado(MS_BLOQUEO_CONEXION / 60000)

    const parsed = pinSchema.safeParse(await request.json().catch(() => null))
    const pin = parsed.success ? parsed.data.pin : ''
    const hallado = esPinValido(pin) ? await buscar(pin, mundos) : null

    if (!hallado) {
      apuntarFallo(POR_NAVEGADOR, navegador.id, MS_BLOQUEO_NAVEGADOR)
      if (ip) apuntarFallo(POR_CONEXION, ip, MS_BLOQUEO_CONEXION)
      await registrarEvento({ tipo: EVENTOS.ACCESO_POR_PIN, exito: false, ip, detalle: { motivo: 'pin_incorrecto' } })
      const quedan = FALLOS_POR_NAVEGADOR - fallosVigentes(POR_NAVEGADOR, navegador.id)
      const respuesta =
        quedan <= 0
          ? bloqueado(MS_BLOQUEO_NAVEGADOR / 60000)
          : NextResponse.json(
              { error: `PIN incorrecto. ${quedan === 1 ? 'Te queda 1 intento' : `Te quedan ${quedan} intentos`}.` },
              { status: 401 },
            )
      if (navegador.nuevo) respuesta.cookies.set(COOKIE_NAVEGADOR, navegador.id, opcionesDeCookieDeFreno)
      return respuesta
    }

    const { profesional, mundo } = hallado
    limpiarIntentos(POR_NAVEGADOR, navegador.id)
    const { token, minutos } = await enMundo(mundo, async () => {
      const deEsta = minutosDeSesion(profesional, await turnoRepository.configuracion())
      const acceso = await turnoRepository.crearAccesoProfesional(profesional.id, deEsta)
      return { token: acceso.token, minutos: deEsta }
    })

    await registrarEvento({
      tipo: EVENTOS.ACCESO_POR_PIN,
      exito: true,
      identificador: profesional.nombre,
      ip,
      detalle: { profesionalId: profesional.id, minutos, demostracion: mundo.demostracion },
    })

    const respuesta = NextResponse.json({ nombre: profesional.nombre })
    // La misma cookie que deja el enlace (ver `proxy.ts`): el consultorio entra igual.
    respuesta.cookies.set(COOKIE_CONSULTORIO, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/consultorio',
      maxAge: minutos * 60,
    })
    // Este navegador es de medico: la app abre directo el PIN la proxima vez.
    respuesta.cookies.set(COOKIE_ENTRADA, ENTRADA_DE_MEDICO, opcionesDeCookieDeFreno)
    if (navegador.nuevo) respuesta.cookies.set(COOKIE_NAVEGADOR, navegador.id, opcionesDeCookieDeFreno)
    return respuesta
  } catch (error) {
    return apiError(error)
  }
}

/**
 * Cambiar LA PROPIA contrasena, con la actual por delante.
 *
 * POR QUE EXISTE APARTE DE /api/usuarios/[id]. Esa ruta es administracion de
 * cuentas: exige la seccion `/admin/usuarios` y sirve para RESTABLECER la clave
 * de otro. Mientras esa fuera la unica forma de cambiar una contrasena, el
 * administrador tenia que conocer la clave nueva de todo el personal para
 * entregarsela, asi que las credenciales de la gente pasaban por un tercero y
 * lo que el registro dice de un turno llamado deja de ser atribuible con
 * seguridad. Aqui no hace falta ninguna seccion —solo tener sesion— y no se
 * puede tocar la cuenta de nadie mas: el id sale de la sesion, nunca del
 * cuerpo de la peticion.
 *
 * Y SE EXIGE LA CONTRASENA ACTUAL porque una sesion abierta es cosa corriente
 * en un mostrador: un equipo desatendido, con una pantalla que cambiara la
 * clave sin pedir nada, es una cuenta regalada.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { usuarioRepository } from '@/lib/usuarios/repositorio'
import { apiError, requireSession } from '@/lib/permissions/session'
import { contextoPeticion, limitarIntentos, limpiarIntentos } from '@/lib/seguridad/registro'
import { registrarApuntes } from '@/lib/seguridad/apuntar'
import { apunteDeContrasenaPropia } from '@/lib/usuarios/auditoria'
import type { Usuario } from '@/lib/usuarios/types'

/**
 * Minimo de 8 caracteres, el mismo que pide la pantalla de usuarios.
 *
 * Se queda igual a proposito: una cuenta no puede quedar mas debil por el
 * camino que se use para cambiarle la clave.
 */
const cambioSchema = z.object({
  actual: z.string().min(1, 'Escribe tu contrasena actual.'),
  nueva: z.string().min(8, 'La contrasena debe tener minimo 8 caracteres.'),
})

/** Cuantas veces se puede fallar la contrasena actual, y en cuanto tiempo. */
const INTENTOS = 5
const MS_VENTANA = 15 * 60 * 1000

export async function POST(request: Request) {
  try {
    const session = await requireSession()

    const parsed = cambioSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const cuenta = await usuarioRepository.buscarPorId(session.user.id)
    if (!cuenta) {
      return NextResponse.json({ error: 'Tu sesion ya no es valida. Vuelve a entrar.' }, { status: 401 })
    }

    // POR CUENTA, NO POR IP: este formulario solo se alcanza con sesion, asi
    // que el identificador que de verdad se esta atacando es la cuenta. Sin
    // tope, la pantalla seria un oraculo para adivinar a ciegas la contrasena
    // de quien dejo la sesion abierta, probando una tras otra sin limite.
    if (!limitarIntentos('cambio_clave_propia', cuenta.id, INTENTOS, MS_VENTANA).permitido) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.' },
        { status: 429 },
      )
    }

    return await cambiar(cuenta, parsed.data, await contextoPeticion())
  } catch (error) {
    return apiError(error)
  }
}

async function cambiar(
  cuenta: Usuario,
  datos: z.infer<typeof cambioSchema>,
  contexto: { ip: string | null },
) {
  const firma = { usuarioId: cuenta.id, usuarioNombre: cuenta.nombre, ip: contexto.ip }

  const actualEsCorrecta = await usuarioRepository.verificarCredenciales(cuenta.usuario, datos.actual)
  if (!actualEsCorrecta) {
    await registrarApuntes([apunteDeContrasenaPropia(cuenta, false, 'contrasena_actual_incorrecta')], firma)
    return NextResponse.json({ error: 'La contrasena actual no es correcta.' }, { status: 400 })
  }

  if (datos.nueva === datos.actual) {
    return NextResponse.json({ error: 'La contrasena nueva debe ser distinta de la actual.' }, { status: 400 })
  }

  // LA CUENTA SE EDITA POR SU ID: no cambia de identidad al cambiar de clave,
  // y el historico de turnos y de eventos sigue apuntando al mismo funcionario.
  await usuarioRepository.actualizar(cuenta.id, { password: datos.nueva })

  // Acerto: se le borra la cuenta de intentos. El limite cuenta FALLOS, no
  // usos, o quien cambia su clave dos veces en un dia se bloquea solo.
  limpiarIntentos('cambio_clave_propia', cuenta.id)

  await registrarApuntes([apunteDeContrasenaPropia(cuenta, true)], firma)

  return NextResponse.json({ ok: true })
}

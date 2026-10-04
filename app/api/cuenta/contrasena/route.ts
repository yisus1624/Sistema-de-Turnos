/**
 * El ADMINISTRADOR cambia SU usuario y/o SU contrasena, con la actual por
 * delante.
 *
 * SOLO EL ADMINISTRADOR (decision del hospital). Las cuentas de los operadores
 * las maneja el administrador desde Usuarios (`/api/usuarios/[id]`): ahi les
 * cambia el nombre de entrada o les restablece la clave. Un operador que
 * llegue hasta aqui recibe 403, y la cuenta de demostracion tambien: su
 * usuario y su clave son los que se reparten para mostrar el sistema.
 *
 * No se puede tocar la cuenta de nadie mas: el id sale de la sesion, nunca del
 * cuerpo de la peticion.
 *
 * Y SE EXIGE LA CONTRASENA ACTUAL porque una sesion abierta es cosa corriente
 * en un mostrador: un equipo desatendido, con una pantalla que cambiara la
 * clave o el usuario sin pedir nada, es una cuenta regalada.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { usuarioRepository } from '@/lib/usuarios/repositorio'
import { apiError, exigirCuentaReal, requireRol } from '@/lib/permissions/session'
import { contextoPeticion, limitarIntentos, limpiarIntentos } from '@/lib/seguridad/registro'
import { registrarApuntes } from '@/lib/seguridad/apuntar'
import { apunteDeContrasenaPropia, apunteDeRenombradoFallido, apuntesDeEdicion } from '@/lib/usuarios/auditoria'
import type { Usuario } from '@/lib/usuarios/types'

/**
 * Minimo de 8 caracteres, el mismo que pide la pantalla de usuarios; y el
 * usuario con las mismas reglas que al crearlo (ver `/api/usuarios`).
 */
const cambioSchema = z
  .object({
    // Con el mismo tope que el inicio de sesion (ver `loginSchema`): bcrypt en el
    // servidor, y una contrasena de megas es trabajo gratis para quien quiera
    // cansarlo.
    actual: z.string().min(1, 'Escribe tu contrasena actual.').max(200, 'La contrasena es demasiado larga.'),
    nueva: z
      .string()
      .min(8, 'La contrasena debe tener minimo 8 caracteres.')
      .max(200, 'La contrasena es demasiado larga.')
      .optional(),
    usuario: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'El usuario debe tener al menos 3 caracteres.')
      .max(40)
      .regex(/^[a-z0-9._-]+$/, 'El usuario solo admite letras, numeros, punto, guion y guion bajo.')
      .optional(),
  })
  .refine((datos) => datos.nueva !== undefined || datos.usuario !== undefined, {
    message: 'Escribe un usuario nuevo o una contrasena nueva.',
  })

/** Cuantas veces se puede fallar la contrasena actual, y en cuanto tiempo. */
const INTENTOS = 5
const MS_VENTANA = 15 * 60 * 1000

export async function POST(request: Request) {
  try {
    const session = await requireRol(['ADMINISTRADOR'])
    exigirCuentaReal(session)

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

  if (datos.nueva !== undefined && datos.nueva === datos.actual) {
    return NextResponse.json({ error: 'La contrasena nueva debe ser distinta de la actual.' }, { status: 400 })
  }

  const usuarioNuevo = datos.usuario !== undefined && datos.usuario !== cuenta.usuario ? datos.usuario : undefined
  if (usuarioNuevo === undefined && datos.nueva === undefined) {
    return NextResponse.json({ error: 'Ese ya es tu usuario: no hay nada que cambiar.' }, { status: 400 })
  }

  // LA CUENTA SE EDITA POR SU ID: no cambia de identidad al cambiar de nombre
  // o de clave, y el historico de turnos y de eventos sigue apuntando al mismo
  // funcionario.
  let actualizada: Usuario
  try {
    actualizada = await usuarioRepository.actualizar(cuenta.id, {
      ...(usuarioNuevo !== undefined ? { usuario: usuarioNuevo } : {}),
      ...(datos.nueva !== undefined ? { password: datos.nueva } : {}),
    })
  } catch (error) {
    // El unico esperable: el nombre de usuario ya lo tiene otra cuenta.
    if (usuarioNuevo !== undefined) {
      await registrarApuntes([apunteDeRenombradoFallido(cuenta, usuarioNuevo, 'usuario_ya_tomado')], firma)
    }
    throw error
  }

  // Acerto: se le borra la cuenta de intentos. El limite cuenta FALLOS, no
  // usos, o quien cambia su clave dos veces en un dia se bloquea solo.
  limpiarIntentos('cambio_clave_propia', cuenta.id)

  await registrarApuntes(
    [
      ...(usuarioNuevo !== undefined ? apuntesDeEdicion({ antes: cuenta, despues: actualizada, passwordCambiada: false }) : []),
      ...(datos.nueva !== undefined ? [apunteDeContrasenaPropia(actualizada, true)] : []),
    ],
    firma,
  )

  return NextResponse.json({ ok: true, usuario: actualizada.usuario })
}

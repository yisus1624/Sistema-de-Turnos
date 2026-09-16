/**
 * Purga de datos de pacientes de los dias viejos.
 *
 * `GET` solo cuenta lo que se tocaria: es la vista previa, y no escribe nada.
 * `POST` lo hace. Van separados a proposito para que la pantalla pueda enseñar
 * el numero ANTES de pedir la confirmacion; un boton que solo dice "purgar" no
 * da forma de saber si el limite que se escribio es el que se queria.
 *
 * SOLO PARA QUIEN ADMINISTRA EL CATALOGO, no para quien carga la agenda. Subir
 * el reporte del hospital es trabajo diario y se le puede encargar al operador
 * del mostrador; esto se hace cada varios meses y no se deshace.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { limiteDeRetencion, previsualizarPurga, purgarDatosDePacientes } from '@/lib/citas/purga'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { apiError, requireRol } from '@/lib/permissions/session'
import { prisma } from '@/lib/prisma'
import { esFechaValida } from '@/lib/turnos/tiempo'

/** Tipo del apunte. Se usa dos veces: en memoria y en la base. */
const EVENTO = 'citas.datos.purgados'

const cuerpo = z.object({
  limite: z.string().refine(esFechaValida, 'La fecha limite no es valida.'),
  /**
   * La misma fecha, escrita a mano por quien confirma.
   *
   * No es burocracia: esto no tiene deshacer. Tecleando el limite se lee una
   * vez mas lo que se va a anonimizar, y un clic de mas en el dialogo
   * equivocado deja de bastar.
   */
  confirmacion: z.string(),
})

export async function GET(request: Request) {
  try {
    await requireRol(['ADMINISTRADOR'])

    const pedido = new URL(request.url).searchParams.get('limite')
    if (pedido && !esFechaValida(pedido)) {
      return NextResponse.json({ error: 'La fecha limite no es valida.' }, { status: 400 })
    }

    return NextResponse.json(await previsualizarPurga(pedido ?? limiteDeRetencion()))
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRol(['ADMINISTRADOR'])

    const parsed = cuerpo.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
    }
    if (parsed.data.confirmacion.trim() !== parsed.data.limite) {
      return NextResponse.json(
        { error: 'La fecha escrita no coincide con la del limite.' },
        { status: 400 },
      )
    }

    const resumen = await purgarDatosDePacientes(parsed.data.limite)

    // Lo que se anonimizo no se puede volver a mirar para saber que se
    // anonimizo: este apunte es lo unico que queda de la operacion.
    const { ip } = await contextoPeticion()
    const detalle = {
      anterioresA: resumen.limite,
      dias: resumen.dias,
      citas: resumen.citas,
      turnos: resumen.turnos,
    }
    registrarEvento({
      tipo: EVENTO,
      exito: true,
      usuarioId: session.user.id,
      identificador: resumen.limite,
      ip,
      detalle,
    })

    // Y ADEMAS A LA BASE DE DATOS, que es la excepcion y no la regla.
    //
    // `registrarEvento` guarda en memoria del proceso y se pierde al reiniciar
    // (ver `lib/seguridad/registro.ts`: es temporal, a la espera de la fuente
    // del hospital). Para casi todo el registro eso es un limite conocido; para
    // esta operacion no puede serlo. Es la unica accion del sistema que no se
    // deshace, y un reinicio no puede dejar al hospital sin forma de saber que
    // alguien anonimizo medio año de agenda, cuando ni con que limite.
    //
    // Se hace aparte y no dentro de `registrarEvento` a proposito: llevar el
    // registro entero a la base es un cambio con sus propias decisiones
    // (cuanto se conserva, si la IP y el documento del paciente deben quedar
    // escritos para siempre) y no algo que deba colarse aqui.
    try {
      await prisma.eventoSeguridad.create({
        data: {
          tipo: EVENTO,
          exito: true,
          usuarioId: session.user.id,
          identificador: resumen.limite,
          ip,
          detalle,
        },
      })
    } catch (fallo) {
      // Que no se pueda apuntar no deshace lo ya hecho: se avisa y se sigue.
      console.error('[purga] no se pudo guardar el apunte en la base', fallo)
    }

    return NextResponse.json(resumen)
  } catch (error) {
    return apiError(error)
  }
}

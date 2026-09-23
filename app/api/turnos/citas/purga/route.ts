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
import { EVENTOS } from '@/lib/seguridad/eventos'
import { apiError, requireRol } from '@/lib/permissions/session'
import { esFechaValida } from '@/lib/turnos/tiempo'
import { conFrenoDeConsultaPesada } from '@/lib/seguridad/freno-consultas'

/** Tipo del apunte en el registro de actividad. */
const EVENTO = EVENTOS.CITAS_DATOS_PURGADOS

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
    const session = await requireRol(['ADMINISTRADOR'])

    const pedido = new URL(request.url).searchParams.get('limite')
    if (pedido && !esFechaValida(pedido)) {
      return NextResponse.json({ error: 'La fecha limite no es valida.' }, { status: 400 })
    }

    const { ip } = await contextoPeticion()
    const vista = await conFrenoDeConsultaPesada('purga_vista', { usuarioId: session.user.id, ip }, () =>
      previsualizarPurga(pedido ?? limiteDeRetencion()),
    )
    return NextResponse.json(vista)
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

    const { ip } = await contextoPeticion()
    const resumen = await conFrenoDeConsultaPesada('purga', { usuarioId: session.user.id, ip }, () =>
      purgarDatosDePacientes(parsed.data.limite),
    )

    // Lo que se anonimizo no se puede volver a mirar para saber que se
    // anonimizo: este apunte es lo unico que queda de la operacion.
    const detalle = {
      anterioresA: resumen.limite,
      dias: resumen.dias,
      citas: resumen.citas,
      turnos: resumen.turnos,
    }
    await registrarEvento({
      tipo: EVENTO,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: resumen.limite,
      ip,
      detalle,
    })

    // Ya no se apunta aparte en la base.
    //
    // Antes esta ruta escribia ADEMAS su propia fila en `eventos_seguridad`,
    // porque `registrarEvento` guardaba en memoria y esta es la unica accion
    // del sistema que no se deshace: un reinicio no podia dejar al hospital sin
    // forma de saber que alguien anonimizo medio año de agenda. Ahora el
    // registro entero se guarda, asi que ese apunte doble solo dejaria la
    // misma purga escrita dos veces en la pantalla.

    return NextResponse.json(resumen)
  } catch (error) {
    return apiError(error)
  }
}

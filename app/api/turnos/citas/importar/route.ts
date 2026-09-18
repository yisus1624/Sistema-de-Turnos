/**
 * Carga del reporte de citas del hospital.
 *
 * La pueden usar el ADMINISTRADOR (desde `/admin/citas`) y el OPERADOR (desde
 * `/operador/agenda`): son los dos que abren el hospital por la mañana, y
 * dejarlo solo en administracion significaria que el dia que el administrador
 * no esta, no hay agenda.
 *
 * El permiso se pide por SECCION y no por rol, como el resto de la
 * administracion: el administrador puede darle una seccion suelta a un operador
 * (ver `lib/permissions/rutas.ts`), y la API tiene que aceptar exactamente a
 * quien la pantalla le deja entrar. Con `requireRol` el operador veria el boton
 * y la carga le fallaria con un 403.
 */
import { NextResponse } from 'next/server'
import { importarReporteDeCitas } from '@/lib/citas/importar-reporte'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { registrarEvento, contextoPeticion } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { detalleDeImportacion } from '@/lib/citas/rastro-importacion'

/**
 * Tope del archivo.
 *
 * El reporte de un dia son ~300 citas y pesa menos de 1 MB. 10 MB deja sitio de
 * sobra para un mes entero y para el mismo informe exportado a Excel, y a la
 * vez impide que alguien mande un archivo de cientos de megas que deje el
 * servidor masticando memoria mientras el mostrador espera.
 */
const MAXIMO_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const session = await requireSeccion('/admin/citas', '/operador/agenda')

    const formulario = await request.formData()
    const archivo = formulario.get('archivo')

    if (!(archivo instanceof File)) {
      return NextResponse.json({ error: 'Adjunta el archivo del reporte de citas.' }, { status: 400 })
    }
    if (archivo.size === 0) {
      return NextResponse.json({ error: 'El archivo esta vacio.' }, { status: 400 })
    }
    if (archivo.size > MAXIMO_BYTES) {
      return NextResponse.json(
        { error: `El archivo pesa mas de ${MAXIMO_BYTES / 1024 / 1024} MB. Subelo por dias.` },
        { status: 400 },
      )
    }

    const datos = new Uint8Array(await archivo.arrayBuffer())
    const resumen = await importarReporteDeCitas({
      archivo: archivo.name,
      datos,
      usuarioId: session.user.id,
    })

    // Queda en el registro de actividad: cargar la agenda del dia cambia lo que
    // ve todo el hospital, y es de las pocas acciones donde hay que poder
    // responder despues quien la hizo y a que hora.
    const { ip } = await contextoPeticion()
    await registrarEvento({
      tipo: EVENTOS.CITAS_IMPORTADAS,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      identificador: archivo.name,
      ip,
      // El catalogo que la carga crea sola y las jornadas que corrige —con su
      // valor anterior— van en el detalle: son cambios que hizo el sistema, no
      // una persona, y son los que despues nadie sabe de donde salieron.
      detalle: detalleDeImportacion(resumen),
    })

    return NextResponse.json(resumen)
  } catch (error) {
    return apiError(error)
  }
}

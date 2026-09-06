import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion, requireSession } from '@/lib/permissions/session'

/**
 * Catalogo de servicios para las pantallas internas.
 *
 * EXIGE SESION. Antes era publica "para la pantalla de la sala de espera", pero
 * el televisor no la consulta: se pinta entero con `/api/turnos/pantalla`, que
 * ya trae el nombre del servicio de cada casilla. Los unicos que la piden son
 * pantallas con sesion (administracion, operador, enlaces). Quedaba entonces un
 * endpoint abierto que le entregaba el catalogo de servicios del hospital a
 * cualquiera que supiera la URL, sin que nadie lo necesitara asi.
 *
 * Con `?todos=1` incluye tambien los servicios INACTIVOS, y para eso hace falta
 * ademas una seccion de catalogo. Sin ese parametro la administracion nunca
 * volvia a ver un servicio que acababa de desactivar (esta lista era la unica
 * que consultaba), asi que apagar el interruptor lo borraba del catalogo para
 * siempre.
 */
export async function GET(request: Request) {
  try {
    const incluirInactivos = new URL(request.url).searchParams.get('todos') === '1'
    await requireSession()
    // Cualquiera de las pantallas de catalogo puede pedirlos: modulos y
    // profesionales tambien necesitan resolver el nombre de un servicio
    // inactivo para no mostrar "Servicio eliminado" al lado de un consultorio
    // que sigue existiendo.
    if (incluirInactivos) {
      await requireSeccion('/admin/servicios', '/admin/modulos', '/admin/profesionales')
    }

    const servicios = await turnoRepository.listarServicios(incluirInactivos)
    return NextResponse.json({ servicios })
  } catch (error) {
    return apiError(error)
  }
}

const servicioSchema = z.object({
  nombre: z.string().trim().min(3, 'El nombre debe tener al menos 3 caracteres.').max(60),
  prefijo: z
    .string()
    .trim()
    .min(1, 'El prefijo es obligatorio.')
    .max(3, 'El prefijo no puede pasar de 3 letras.')
    .regex(/^[A-Za-z]+$/, 'El prefijo solo admite letras.'),
  modoFila: z.enum(['COMPARTIDA', 'POR_PROFESIONAL']),
  activo: z.boolean().default(true),
})

export async function POST(request: Request) {
  try {
    await requireSeccion('/admin/servicios')

    const body = await request.json().catch(() => null)
    const parsed = servicioSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos invalidos.' }, { status: 400 })
    }

    const servicio = await turnoRepository.crearServicio(parsed.data)
    return NextResponse.json({ servicio })
  } catch (error) {
    return apiError(error)
  }
}

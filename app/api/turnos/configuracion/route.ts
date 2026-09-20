import { NextResponse } from 'next/server'
import { z } from 'zod'
import { turnoRepository } from '@/lib/turnos/repositorio'
import { apiError, requireSeccion } from '@/lib/permissions/session'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import { camposCambiados } from '@/lib/seguridad/cambios'
import { DISENOS_PANTALLA, type ConfiguracionSistema } from '@/lib/turnos/types'

export async function GET() {
  try {
    await requireSeccion('/admin/pantalla')
    const configuracion = await turnoRepository.configuracion()
    return NextResponse.json({ configuracion })
  } catch (error) {
    return apiError(error)
  }
}

/** Hora del dia en formato de 24 horas, "07:00". */
const hora = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora debe tener el formato HH:MM, por ejemplo 07:00.')

const configuracionSchema = z.object({
  /**
   * Version que el administrador tenia delante al abrir la pantalla. Se exige
   * porque la pantalla manda el objeto entero: sin ella, el segundo en guardar
   * revierte en silencio lo que acaba de cambiar el primero.
   */
  actualizadoEn: z
    .string()
    .datetime({ message: 'Vuelve a cargar la pantalla de configuracion antes de guardar.' }),

  audioActivo: z.boolean().optional(),
  volumen: z.number().min(0).max(1).optional(),
  mensajePie: z.string().trim().max(200).optional(),

  // --- Aspecto del televisor ---
  disenoPantalla: z.enum(DISENOS_PANTALLA).optional(),
  /*
   * Ruta de la imagen de fondo, y SOLO una ruta de este mismo sitio.
   *
   * Se exige que empiece por una barra y se prohibe "//" y "..": sin eso, aqui
   * se podria escribir la direccion de un servidor cualquiera de internet y el
   * televisor de la sala de espera —que esta encendido todo el dia y no tiene
   * a nadie mirandolo de cerca— acabaria pidiendole una imagen a ese servidor
   * en cada carga, contandole de paso que existe y desde donde se conecta. La
   * imagen del hospital se copia en `public/` y se pone su ruta.
   */
  fondoPantalla: z
    .string()
    .trim()
    .max(200)
    .refine(
      (valor) => valor === '' || (valor.startsWith('/') && !valor.startsWith('//') && !valor.includes('..')),
      'La imagen de fondo debe ser una ruta de este mismo sitio, por ejemplo /img/fondo-sala.jpg',
    )
    .optional(),

  // --- Agenda ---
  // La duracion se acota a un rango razonable de consulta; las horas se
  // validan con forma "HH:MM" y la coherencia (cierre despues de la apertura)
  // la comprueba `guardarConfiguracion`, que es quien ve las cuatro juntas.
  duracionCitaMinutos: z.number().int().min(5).max(120).optional(),
  jornadaMananaInicio: hora.optional(),
  jornadaMananaFin: hora.optional(),
  jornadaTardeInicio: hora.optional(),
  jornadaTardeFin: hora.optional(),
})

export async function PUT(request: Request) {
  try {
    const session = await requireSeccion('/admin/pantalla')
    const { ip } = await contextoPeticion()

    const body = await request.json().catch(() => null)
    const parsed = configuracionSchema.safeParse(body)
    if (!parsed.success) {
      const motivo = parsed.error.issues[0]?.message ?? 'Datos invalidos.'
      await apuntarIntentoFallido(session, ip, motivo)
      return NextResponse.json({ error: motivo }, { status: 400 })
    }

    // El estado anterior se lee ANTES de guardar: despues ya no hay contra que
    // comparar, y sin el antes no se puede devolver el horario a como estaba.
    const anterior = await turnoRepository.configuracion()
    const { actualizadoEn: visto, ...cambios } = parsed.data
    const configuracion = await guardarOApuntarElFallo({ session, ip, cambios, anterior, visto })

    // Cambiar las jornadas o la duracion de la consulta le mueve la agenda a
    // todo el hospital y puede dejar citas fuera de horario: tiene que quedar
    // constancia de quien lo hizo y de que valores toco.
    await registrarEvento({
      tipo: EVENTOS.CONFIGURACION_ACTUALIZADA,
      exito: true,
      usuarioId: session.user.id,
      usuarioNombre: session.user.name ?? null,
      ip,
      // Solo lo que de verdad cambio: la pantalla manda el objeto entero cada
      // vez que se pulsa guardar, asi que la lista de claves recibidas apuntaba
      // los nueve parametros aunque no se hubiera tocado ninguno.
      detalle: { cambios: camposCambiados(anterior, cambios) },
    })

    return NextResponse.json({ configuracion })
  } catch (error) {
    return apiError(error)
  }
}

/** Lo minimo que hace falta de la sesion para firmar el apunte. */
interface FirmaDelCambio {
  user: { id: string; name?: string | null }
}

/**
 * Guarda, y si el dominio rechaza el horario deja escrito el intento antes de
 * dejar salir el error.
 *
 * Un administrador intentando dejar el hospital sin franjas en las que agendar
 * tiene que aparecer en el registro, aunque el sistema se lo haya impedido.
 */
async function guardarOApuntarElFallo(peticion: {
  session: FirmaDelCambio
  ip: string | null
  cambios: Partial<ConfiguracionSistema>
  anterior: ConfiguracionSistema
  /** Version que el administrador tenia delante; ver `guardarConfiguracion`. */
  visto: string
}) {
  const { session, ip, cambios, anterior, visto } = peticion
  try {
    return await turnoRepository.guardarConfiguracion(cambios, { visto })
  } catch (error) {
    const motivo = error instanceof Error ? error.message : 'No se pudo guardar la configuracion.'
    await apuntarIntentoFallido(session, ip, motivo, camposCambiados(anterior, cambios))
    throw error
  }
}

async function apuntarIntentoFallido(
  session: FirmaDelCambio,
  ip: string | null,
  motivo: string,
  cambios: Record<string, unknown> = {},
) {
  await registrarEvento({
    tipo: EVENTOS.CONFIGURACION_ACTUALIZADA,
    exito: false,
    usuarioId: session.user.id,
    usuarioNombre: session.user.name ?? null,
    ip,
    detalle: { motivo, cambios },
  })
}

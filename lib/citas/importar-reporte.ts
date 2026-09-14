/**
 * Carga diaria de la agenda del hospital.
 *
 * Toma el archivo que ya interpreto `reporte-hospital.ts` y lo deja aplicado en
 * la base: los catalogos que aparezcan (servicio, consultorio, doctor) y una
 * cita por fila. Aqui esta todo lo que toca la base; lo de interpretar el
 * archivo esta al otro lado y no sabe que existe una base de datos.
 *
 * TRES DECISIONES QUE HAY QUE CONOCER ANTES DE TOCAR ESTO:
 *
 * 1. VOLVER A SUBIR EL MISMO ARCHIVO NO DUPLICA NADA. La cita se identifica por
 *    (dia, documento, doctor, hora), que es lo que la identifica tambien en la
 *    agenda del hospital. Se subira dos veces: el operador que no esta seguro
 *    de si ya lo hizo, y el archivo corregido de media mañana. Las dos veces
 *    tiene que ser inofensivo.
 *
 * 2. NO SE TOCA UN PACIENTE QUE YA LLEGO. Si su cita ya paso a PRESENTADO o
 *    ATENDIDA, la carga la deja como esta. Reescribirla podria mandarlo a otra
 *    fila o borrarle el turno que ya tiene en la mano.
 *
 * 3. LAS HORAS ENTRAN TAL CUAL, SIN PASAR POR LA PARRILLA. Las citas que se
 *    crean a mano tienen que caer en una franja exacta (7:00, 7:15, 7:30...);
 *    las del hospital no: en el reporte real hay citas a las 7:09 y a las 7:13.
 *    Redondearlas seria cambiarle al paciente la hora que le dieron, asi que se
 *    guarda la que trae el reporte. La consecuencia esta a la vista: en la
 *    parrilla de la agenda esas citas salen en "fuera de horario". El flujo del
 *    dia —buscar por documento, registrar la llegada, la lista del doctor— no
 *    usa la parrilla y funciona igual.
 *
 * LO QUE NO SE HACE: cancelar las citas del dia que no vengan en el archivo. El
 * archivo puede venir filtrado por doctor o por rango, y borrar la agenda de
 * medio hospital por subir un reporte parcial no tiene vuelta atras. Se cuentan
 * y se informan, para que el operador las mire.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errorDeNegocio } from '@/lib/turnos/errores'
import { recalcularJornadas, type AjusteDeJornada } from './jornadas'
import { leerReporteDelHospital, type ErrorFila, type FilaReporte } from './reporte-hospital'

export interface ResumenCarga {
  cargaId: string
  archivo: string
  /** Dias que trae el archivo. Normalmente uno. */
  fechas: string[]
  filasLeidas: number
  creadas: number
  actualizadas: number
  /** Filas correctas que no se aplicaron (el paciente ya llego, por ejemplo). */
  omitidas: number
  errores: ErrorFila[]
  /** Catalogo dado de alta al vuelo, para que el administrador lo revise. */
  serviciosNuevos: string[]
  consultoriosNuevos: string[]
  profesionalesNuevos: string[]
  /**
   * Citas que ya estaban en el sistema para esos dias y NO venian en el
   * archivo. No se tocan: solo se cuentan, porque un reporte parcial no puede
   * borrar la agenda.
   */
  citasNoIncluidas: number
  /**
   * Doctores a los que la carga les corrigio la jornada segun las horas a las
   * que atienden. Se informa para que el administrador lo vea: es un cambio que
   * afecta a la parrilla y a lo que se le puede agendar despues.
   */
  jornadasAjustadas: AjusteDeJornada[]
}

/**
 * Los rechazos, listos para guardarse en la columna Json.
 *
 * Prisma no acepta un tipo con forma propia donde espera Json: `ErrorFila[]` es
 * serializable, pero su tipo no encaja con `InputJsonValue`. Se convierte en un
 * solo sitio, con nombre, en vez de repartir conversiones por el archivo.
 */
function comoJson(errores: ErrorFila[]): Prisma.InputJsonValue | undefined {
  return errores.length > 0 ? (errores as unknown as Prisma.InputJsonValue) : undefined
}

/** Cuantas filas se aceptan de una sola vez. */
const MAXIMO_FILAS = 20000

export async function importarReporteDeCitas(params: {
  archivo: string
  datos: Uint8Array
  usuarioId?: string | null
}): Promise<ResumenCarga> {
  const reporte = await leerReporteDelHospital(params.datos)

  if (reporte.filas.length === 0) {
    // El archivo no sirvio. Se registra igual: al dia siguiente, cuando alguien
    // pregunte por que no hay agenda, el rastro de que se intento y de que dijo
    // el sistema es justo lo que hace falta.
    await prisma.cargaCitas.create({
      data: {
        archivo: params.archivo,
        subidaPor: params.usuarioId ?? null,
        filasLeidas: 0,
        errores: comoJson(reporte.errores),
      },
    })

    errorDeNegocio(
      reporte.errores[0]?.motivo ??
        'El archivo no contiene ninguna cita. Verifica que sea el Reporte de citas asignadas.',
    )
  }

  if (reporte.filas.length > MAXIMO_FILAS) {
    errorDeNegocio(
      `El archivo trae ${reporte.filas.length} citas, mas de las ${MAXIMO_FILAS} que se cargan de una vez. Subelo por dias.`,
    )
  }

  const catalogo = await asegurarCatalogo(reporte.filas)
  const carga = await prisma.cargaCitas.create({
    data: {
      archivo: params.archivo,
      subidaPor: params.usuarioId ?? null,
      fecha: reporte.fechas.length === 1 ? reporte.fechas[0] : null,
      filasLeidas: reporte.filas.length,
    },
  })

  const aplicado = await aplicarCitas(reporte.filas, catalogo, carga.id)

  // Despues de aplicar, no antes: la jornada se deduce de las citas que el
  // doctor tiene de verdad esos dias, y las de este archivo ya estan puestas.
  // Solo los dias del archivo y solo sus doctores: una carga no tiene por que
  // opinar sobre quien no aparece en ella.
  const jornadasAjustadas = await recalcularJornadas({
    fechas: reporte.fechas,
    profesionalIds: [...new Set(catalogo.profesionales.values())],
  })

  const noIncluidas = await contarCitasNoIncluidas(reporte.fechas, aplicado.vistas)

  const resumen: ResumenCarga = {
    cargaId: carga.id,
    archivo: params.archivo,
    fechas: reporte.fechas,
    filasLeidas: reporte.filas.length,
    creadas: aplicado.creadas,
    actualizadas: aplicado.actualizadas,
    omitidas: aplicado.omitidas,
    errores: [...reporte.errores, ...aplicado.errores],
    serviciosNuevos: catalogo.serviciosNuevos,
    consultoriosNuevos: catalogo.consultoriosNuevos,
    profesionalesNuevos: catalogo.profesionalesNuevos,
    citasNoIncluidas: noIncluidas,
    jornadasAjustadas,
  }

  await prisma.cargaCitas.update({
    where: { id: carga.id },
    data: {
      creadas: resumen.creadas,
      actualizadas: resumen.actualizadas,
      omitidas: resumen.omitidas,
      errores: comoJson(resumen.errores),
    },
  })

  return resumen
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

interface Catalogo {
  /** clave del servicio (su nombre) -> id */
  servicios: Map<string, string>
  /** claveExterna del consultorio -> id */
  consultorios: Map<string, string>
  /** claveExterna del doctor -> id */
  profesionales: Map<string, string>
  serviciosNuevos: string[]
  consultoriosNuevos: string[]
  profesionalesNuevos: string[]
}

/**
 * Da de alta lo que el archivo mencione y todavia no exista.
 *
 * EL CATALOGO SALE DEL REPORTE, no se escribe a mano. Pedirle al administrador
 * que registre catorce doctores y cuatro consultorios antes de la primera carga
 * —y que acierte a escribirlos igual que el sistema del hospital— es pedir que
 * la carga falle el primer dia. Lo que se crea queda listado en el resumen para
 * que lo revise: los nombres se pueden cambiar despues sin romper nada, porque
 * el emparejamiento va por `claveExterna` y no por el nombre visible.
 *
 * Los doctores entran con jornada COMPLETA de forma provisional: el reporte no
 * trae una columna que diga en que jornada trabaja cada uno, y COMPLETA es la
 * unica opcion que no deja a nadie fuera de su propio horario mientras se
 * insertan sus citas. Terminada la carga, `ajustarJornadas` se la corrige a
 * partir de las horas a las que de verdad atiende.
 */
async function asegurarCatalogo(filas: FilaReporte[]): Promise<Catalogo> {
  const catalogo: Catalogo = {
    servicios: new Map(),
    consultorios: new Map(),
    profesionales: new Map(),
    serviciosNuevos: [],
    consultoriosNuevos: [],
    profesionalesNuevos: [],
  }

  // --- Servicios ---
  const serviciosDelArchivo = new Map(filas.map((f) => [f.servicio.nombre, f.servicio]))
  for (const [nombre, servicio] of serviciosDelArchivo) {
    const existente = await prisma.servicio.findUnique({ where: { nombre } })
    if (existente) {
      catalogo.servicios.set(nombre, existente.id)
      continue
    }

    // Si el prefijo ya lo usa otro servicio se busca el siguiente libre: el
    // codigo del turno tiene que ser unico en la sala de espera, y fallar la
    // carga entera por una letra ocupada seria desproporcionado.
    const prefijo = await prefijoLibre(servicio.prefijo)
    const creado = await prisma.servicio.create({
      data: { nombre, prefijo, modoFila: 'POR_PROFESIONAL', activo: true },
    })
    catalogo.servicios.set(nombre, creado.id)
    catalogo.serviciosNuevos.push(nombre)
  }

  // --- Consultorios ---
  //
  // El consultorio se queda con el servicio de la PRIMERA cita que lo use. En
  // el reporte del hospital el nombre ya lleva el servicio dentro
  // ("CONS 01- ODONTOLOGIA"), asi que no se mezclan.
  const consultoriosDelArchivo = new Map<string, { nombre: string; servicioId: string }>()
  for (const fila of filas) {
    if (!fila.consultorio || consultoriosDelArchivo.has(fila.consultorio.clave)) continue
    consultoriosDelArchivo.set(fila.consultorio.clave, {
      nombre: fila.consultorio.nombre,
      servicioId: catalogo.servicios.get(fila.servicio.nombre)!,
    })
  }

  for (const [clave, datos] of consultoriosDelArchivo) {
    const existente = await prisma.modulo.findUnique({ where: { claveExterna: clave } })
    if (existente) {
      catalogo.consultorios.set(clave, existente.id)
      continue
    }

    const creado = await prisma.modulo.create({
      data: {
        // El nombre puede chocar con uno creado a mano que se llame igual. En
        // ese caso se le pega la clave del hospital para que la carga no falle;
        // el administrador lo renombra despues.
        nombre: await nombreDeModuloLibre(datos.nombre),
        claveExterna: clave,
        servicioId: datos.servicioId,
        activo: true,
      },
    })
    catalogo.consultorios.set(clave, creado.id)
    catalogo.consultoriosNuevos.push(datos.nombre)
  }

  // --- Profesionales ---
  const profesionalesDelArchivo = new Map<
    string,
    { nombre: string; servicioId: string; moduloId: string | null }
  >()
  for (const fila of filas) {
    if (profesionalesDelArchivo.has(fila.profesional.clave)) continue
    profesionalesDelArchivo.set(fila.profesional.clave, {
      nombre: fila.profesional.nombre,
      servicioId: catalogo.servicios.get(fila.servicio.nombre)!,
      moduloId: fila.consultorio ? (catalogo.consultorios.get(fila.consultorio.clave) ?? null) : null,
    })
  }

  for (const [clave, datos] of profesionalesDelArchivo) {
    const existente = await prisma.profesional.findUnique({ where: { claveExterna: clave } })
    if (existente) {
      catalogo.profesionales.set(clave, existente.id)
      continue
    }

    const creado = await prisma.profesional.create({
      data: {
        nombre: await nombreDeProfesionalLibre(datos.nombre),
        claveExterna: clave,
        servicioId: datos.servicioId,
        // Provisional: `ajustarJornadas` la corrige al final de la carga, con
        // las citas ya puestas. El reporte no trae la jornada en ninguna columna.
        jornada: 'COMPLETA',
        moduloId: datos.moduloId,
        activo: true,
      },
    })
    catalogo.profesionales.set(clave, creado.id)
    catalogo.profesionalesNuevos.push(datos.nombre)
  }

  return catalogo
}

async function prefijoLibre(deseado: string) {
  const letras = [deseado, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]
  for (const letra of letras) {
    const ocupado = await prisma.servicio.findFirst({ where: { prefijo: letra }, select: { id: true } })
    if (!ocupado) return letra
  }
  errorDeNegocio('No quedan prefijos de turno libres. Revisa los servicios en la administracion.')
}

async function nombreDeModuloLibre(deseado: string) {
  const ocupado = await prisma.modulo.findUnique({ where: { nombre: deseado }, select: { id: true } })
  return ocupado ? `${deseado} (importado)` : deseado
}

async function nombreDeProfesionalLibre(deseado: string) {
  const ocupado = await prisma.profesional.findUnique({ where: { nombre: deseado }, select: { id: true } })
  return ocupado ? `${deseado} (importado)` : deseado
}

// ---------------------------------------------------------------------------
// Citas
// ---------------------------------------------------------------------------

/** Como se identifica una cita entre la agenda del hospital y la nuestra. */
function claveDeCita(fecha: string, documento: string, profesionalId: string, horaCitaIso: string) {
  return `${fecha}|${documento}|${profesionalId}|${horaCitaIso}`
}

interface Aplicado {
  creadas: number
  actualizadas: number
  omitidas: number
  errores: ErrorFila[]
  /** Claves de las citas que venian en el archivo. */
  vistas: Set<string>
}

/**
 * Aplica las filas.
 *
 * Se leen de golpe TODAS las citas que ya existen de esos dias y se comparan en
 * memoria, en vez de consultar la base una vez por fila. Son ~300 citas al dia
 * contra un servidor que esta al otro lado de internet: fila por fila, la carga
 * pasa de un segundo a varios minutos con el operador mirando una barra.
 */
async function aplicarCitas(filas: FilaReporte[], catalogo: Catalogo, cargaId: string): Promise<Aplicado> {
  const fechas = [...new Set(filas.map((f) => f.fecha))]

  const existentes = await prisma.cita.findMany({ where: { fecha: { in: fechas } } })
  const porClave = new Map(
    existentes.map((c) => [
      claveDeCita(c.fecha, c.documentoPaciente, c.profesionalId, c.horaCita.toISOString()),
      c,
    ]),
  )

  const resultado: Aplicado = {
    creadas: 0,
    actualizadas: 0,
    omitidas: 0,
    errores: [],
    vistas: new Set(),
  }

  const nuevas: Array<{
    documentoPaciente: string
    tipoDocumento: string | null
    nombrePaciente: string
    profesionalId: string
    servicioId: string
    horaCita: Date
    fecha: string
    procedimiento: string | null
    cups: string | null
    origen: 'IMPORTACION'
    cargaId: string
  }> = []

  const cambios: Array<{ id: string; datos: Record<string, unknown> }> = []

  for (const fila of filas) {
    const profesionalId = catalogo.profesionales.get(fila.profesional.clave)
    const servicioId = catalogo.servicios.get(fila.servicio.nombre)
    if (!profesionalId || !servicioId) {
      resultado.errores.push({ fila: fila.fila, motivo: 'No se pudo resolver el doctor o el servicio.' })
      continue
    }

    const clave = claveDeCita(fila.fecha, fila.documentoPaciente, profesionalId, fila.horaCita)

    // El mismo archivo puede traer la fila repetida. La segunda no es un error
    // ni una cita nueva: es la misma.
    if (resultado.vistas.has(clave)) {
      resultado.omitidas += 1
      continue
    }
    resultado.vistas.add(clave)

    const existente = porClave.get(clave)

    if (!existente) {
      nuevas.push({
        documentoPaciente: fila.documentoPaciente,
        tipoDocumento: fila.tipoDocumento,
        nombrePaciente: fila.nombrePaciente,
        profesionalId,
        servicioId,
        horaCita: new Date(fila.horaCita),
        fecha: fila.fecha,
        procedimiento: fila.procedimiento,
        cups: fila.cups,
        // Queda marcada como importada: una cita que puso el operador a mano y
        // una que trajo el reporte no se corrigen igual, y sin esta marca no
        // hay forma de distinguirlas al revisar un dia.
        origen: 'IMPORTACION',
        cargaId,
      })
      continue
    }

    // El paciente ya llego (o ya lo atendieron), o alguien cancelo la cita
    // aqui: en los tres casos la carga no manda. Reescribirla podria moverlo de
    // fila o dejarlo sin el turno que tiene en la mano.
    if (existente.estado !== 'PROGRAMADA') {
      resultado.omitidas += 1
      continue
    }

    const datos: Record<string, unknown> = {}
    if (existente.nombrePaciente !== fila.nombrePaciente) datos.nombrePaciente = fila.nombrePaciente
    if (existente.tipoDocumento !== fila.tipoDocumento) datos.tipoDocumento = fila.tipoDocumento
    if (existente.procedimiento !== fila.procedimiento) datos.procedimiento = fila.procedimiento
    if (existente.cups !== fila.cups) datos.cups = fila.cups
    if (existente.servicioId !== servicioId) datos.servicioId = servicioId

    if (Object.keys(datos).length === 0) {
      // Ya estaba igual: ni creada ni cambiada. Es el caso normal cuando se
      // vuelve a subir el mismo archivo.
      resultado.omitidas += 1
      continue
    }

    datos.cargaId = cargaId
    cambios.push({ id: existente.id, datos })
  }

  if (nuevas.length > 0) {
    // `skipDuplicates` cubre la carrera de dos operadores subiendo el archivo
    // al mismo tiempo: el indice unico rechaza la repetida en vez de tumbar la
    // carga entera.
    const creadas = await prisma.cita.createMany({ data: nuevas, skipDuplicates: true })
    resultado.creadas = creadas.count
    resultado.omitidas += nuevas.length - creadas.count
  }

  for (const cambio of cambios) {
    await prisma.cita.update({ where: { id: cambio.id }, data: cambio.datos })
  }
  resultado.actualizadas = cambios.length

  return resultado
}

/**
 * Citas de esos dias que ya estaban y no venian en el archivo.
 *
 * Solo se cuentan. Suelen ser citas canceladas en el sistema del hospital
 * despues de la carga anterior, pero tambien salen cuando el reporte viene
 * filtrado por un doctor o por media jornada: cancelarlas automaticamente
 * borraria agenda buena sin vuelta atras.
 */
async function contarCitasNoIncluidas(fechas: string[], vistas: Set<string>) {
  const existentes = await prisma.cita.findMany({
    where: { fecha: { in: fechas }, estado: 'PROGRAMADA' },
    select: { fecha: true, documentoPaciente: true, profesionalId: true, horaCita: true },
  })

  return existentes.filter(
    (c) =>
      !vistas.has(claveDeCita(c.fecha, c.documentoPaciente, c.profesionalId, c.horaCita.toISOString())),
  ).length
}

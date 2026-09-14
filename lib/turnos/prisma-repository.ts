/**
 * Implementacion de `TurnoRepository` contra PostgreSQL (Supabase) via Prisma.
 *
 * Es la MISMA maquina que `in-memory-repository.ts`, con el mismo contrato y
 * las mismas reglas de negocio; lo unico que cambia es donde viven los datos.
 * Las reglas que son puro calendario o puro conteo (`tiempo.ts`,
 * `estadisticas.ts`) se importan en vez de reescribirse: si aqui se contaran
 * las cosas de otra manera, el mismo dia daria numeros distintos segun de
 * donde salieran, que es un fallo que no se ve hasta que alguien compara dos
 * informes.
 *
 * DOS DECISIONES QUE MERECEN EXPLICACION:
 *
 * 1. LA COLUMNA `fecha`. Cada cita y cada turno guardan, ademas del instante,
 *    el dia AAAA-MM-DD en hora de Colombia. Todas las consultas de este
 *    sistema son "lo de un dia", y sin esa columna habria que convertir zona
 *    horaria dentro de cada consulta: el indice deja de servir y el dia pasa a
 *    depender de en que zona este el servidor de base de datos, que no es algo
 *    que se controle.
 *
 * 2. NADA DE LEER-Y-ESCRIBIR A CIEGAS. En memoria, "coge el siguiente de la
 *    fila y marcalo" era atomico porque no habia await en medio. Contra una
 *    base de datos hay varios procesos, y dos doctores pulsando "siguiente" a
 *    la vez leerian el mismo paciente. Aqui el turno se RECLAMA con un update
 *    condicionado al estado (`updateMany ... where estado: EN_ESPERA`): si el
 *    update afecta cero filas, otro se lo llevo y se pasa al siguiente.
 */
import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { realtimeHub } from '@/lib/realtime/hub'
import { errorDeNegocio } from './errores'
import { ordenAtencion, resumir } from './estadisticas'
import {
  ETIQUETA_JORNADA,
  ahoraISO,
  aMinutos,
  atiendeEnJornada,
  bloqueDeCita,
  jornadaSegunHoras,
  diaColombia,
  esFechaValida,
  franjasDeJornada,
  horaColombia,
} from './tiempo'
import type { TurnoRepository } from './repository'
import type {
  AccesoProfesional,
  BloqueHorario,
  CasillaPantalla,
  Cita,
  CitaEnHorario,
  ColumnaHorario,
  ComprobanteLlegada,
  ConfiguracionSistema,
  EstadisticasDia,
  EstadoAgendaItem,
  FiltroHistorico,
  HorarioDia,
  ItemAgendaProfesional,
  Jornada,
  Modulo,
  Profesional,
  Servicio,
  Turno,
} from './types'

import { MINUTOS_ACCESO_MAXIMO, MINUTOS_ACCESO_MINIMO } from './repository'

/** Lo que sirve tanto para el cliente normal como dentro de una transaccion. */
type Ctx = Prisma.TransactionClient | typeof prisma

// ---------------------------------------------------------------------------
// Traduccion fila -> tipo de dominio
//
// Las fechas salen de Prisma como `Date` y el dominio las maneja como ISO
// 8601, que es lo que viaja por la API y lo que la UI sabe leer.
// ---------------------------------------------------------------------------

const iso = (fecha: Date | null | undefined) => (fecha ? fecha.toISOString() : null)

type FilaServicio = Prisma.ServicioGetPayload<object>
type FilaModulo = Prisma.ModuloGetPayload<object>
type FilaProfesional = Prisma.ProfesionalGetPayload<object>
type FilaCita = Prisma.CitaGetPayload<object>
type FilaTurno = Prisma.TurnoGetPayload<object>
type FilaAcceso = Prisma.AccesoProfesionalGetPayload<object>

function aServicio(fila: FilaServicio): Servicio {
  return {
    id: fila.id,
    nombre: fila.nombre,
    prefijo: fila.prefijo,
    modoFila: fila.modoFila,
    activo: fila.activo,
  }
}

function aModulo(fila: FilaModulo): Modulo {
  return { id: fila.id, nombre: fila.nombre, servicioId: fila.servicioId, activo: fila.activo }
}

function aProfesional(fila: FilaProfesional): Profesional {
  return {
    id: fila.id,
    nombre: fila.nombre,
    servicioId: fila.servicioId,
    jornada: fila.jornada,
    moduloId: fila.moduloId,
    usuarioId: fila.usuarioId,
    activo: fila.activo,
  }
}

function aCita(fila: FilaCita): Cita {
  return {
    id: fila.id,
    documentoPaciente: fila.documentoPaciente,
    nombrePaciente: fila.nombrePaciente,
    profesionalId: fila.profesionalId,
    servicioId: fila.servicioId,
    horaCita: fila.horaCita.toISOString(),
    estado: fila.estado,
    creadaEn: iso(fila.creadaEn),
    creadaPor: fila.creadaPor,
    horaCitaOriginal: iso(fila.horaCitaOriginal),
    vecesReprogramada: fila.vecesReprogramada,
    reprogramadaEn: iso(fila.reprogramadaEn),
    reprogramadaPor: fila.reprogramadaPor,
    motivoReprogramacion: fila.motivoReprogramacion,
    canceladaEn: iso(fila.canceladaEn),
    canceladaPor: fila.canceladaPor,
    motivoCancelacion: fila.motivoCancelacion,
  }
}

function aTurno(fila: FilaTurno): Turno {
  return {
    id: fila.id,
    codigo: fila.codigo,
    servicioId: fila.servicioId,
    estado: fila.estado,
    prioridad: fila.prioridad,
    fechaGeneracion: fila.fechaGeneracion.toISOString(),
    horaLlamado: iso(fila.horaLlamado),
    horaPrimerLlamado: iso(fila.horaPrimerLlamado),
    horaAtencion: iso(fila.horaAtencion),
    moduloId: fila.moduloId,
    funcionarioId: fila.funcionarioId,
    vecesLlamado: fila.vecesLlamado,
    cerradoPor: fila.cerradoPor,
    cerradoEn: iso(fila.cerradoEn),
    cierreAutomatico: fila.cierreAutomatico,
    citaId: fila.citaId,
    profesionalId: fila.profesionalId,
    horaCita: iso(fila.horaCita),
    nombrePaciente: fila.nombrePaciente,
  }
}

function aAcceso(fila: FilaAcceso): AccesoProfesional {
  return {
    id: fila.id,
    profesionalId: fila.profesionalId,
    creadoEn: fila.creadoEn.toISOString(),
    expiraEn: fila.expiraEn.toISOString(),
    revocadoEn: iso(fila.revocadoEn),
    ultimoUsoEn: iso(fila.ultimoUsoEn),
  }
}

// ---------------------------------------------------------------------------
// Configuracion (fila unica)
// ---------------------------------------------------------------------------

const ID_CONFIGURACION = 'unica'

const CONFIGURACION_INICIAL: ConfiguracionSistema = {
  audioActivo: true,
  volumen: 1,
  ultimosVisibles: 5,
  mensajePie: 'Bienvenido a la ESE Hospital San Rafael de Chinu. Por favor espere a ser llamado.',
  duracionCitaMinutos: 15,
  jornadaMananaInicio: '07:00',
  jornadaMananaFin: '12:00',
  jornadaTardeInicio: '13:00',
  jornadaTardeFin: '17:00',
}

/**
 * La configuracion, creandola con los valores del hospital la primera vez.
 *
 * Se usa `upsert` y no "buscar, y si no hay crear": con dos peticiones en
 * paralelo el segundo camino intenta insertar dos veces la misma fila y una de
 * las dos peticiones falla sin motivo que el funcionario pueda entender.
 */
async function cargarConfiguracion(ctx: Ctx = prisma): Promise<ConfiguracionSistema> {
  const fila = await ctx.configuracion.upsert({
    where: { id: ID_CONFIGURACION },
    update: {},
    create: { id: ID_CONFIGURACION, ...CONFIGURACION_INICIAL },
  })

  return {
    audioActivo: fila.audioActivo,
    volumen: fila.volumen,
    ultimosVisibles: fila.ultimosVisibles,
    mensajePie: fila.mensajePie,
    duracionCitaMinutos: fila.duracionCitaMinutos,
    jornadaMananaInicio: fila.jornadaMananaInicio,
    jornadaMananaFin: fila.jornadaMananaFin,
    jornadaTardeInicio: fila.jornadaTardeInicio,
    jornadaTardeFin: fila.jornadaTardeFin,
  }
}

/**
 * A que jornada pertenece una franja, o `null` si esa hora no es franja valida
 * de ninguna de las dos.
 *
 * Se compara contra las franjas generadas y no contra el rango a secas, porque
 * lo que importa no es "esta dentro del horario" sino "cae justo en un cupo":
 * las 8:07 estan dentro de la mañana, pero no son hora de consulta si las
 * citas van cada 15 minutos.
 */
function bloqueDeFranja(hora: string, c: ConfiguracionSistema): 'MANANA' | 'TARDE' | null {
  if (franjasDeJornada(c.jornadaMananaInicio, c.jornadaMananaFin, c.duracionCitaMinutos).includes(hora)) {
    return 'MANANA'
  }
  if (franjasDeJornada(c.jornadaTardeInicio, c.jornadaTardeFin, c.duracionCitaMinutos).includes(hora)) {
    return 'TARDE'
  }
  return null
}

// ---------------------------------------------------------------------------
// Busquedas con mensaje de negocio
// ---------------------------------------------------------------------------

async function exigirServicio(id: string, ctx: Ctx = prisma) {
  const servicio = await ctx.servicio.findUnique({ where: { id } })
  if (!servicio) errorDeNegocio('El servicio indicado no existe.')
  return servicio
}

async function exigirProfesional(id: string, ctx: Ctx = prisma) {
  const profesional = await ctx.profesional.findUnique({ where: { id } })
  if (!profesional) errorDeNegocio('El profesional indicado no existe.')
  return profesional
}

async function exigirModulo(id: string, ctx: Ctx = prisma) {
  const modulo = await ctx.modulo.findUnique({ where: { id } })
  if (!modulo) errorDeNegocio('El modulo indicado no existe.')
  return modulo
}

async function exigirTurno(id: string, ctx: Ctx = prisma) {
  const turno = await ctx.turno.findUnique({ where: { id } })
  if (!turno) errorDeNegocio('El turno indicado no existe.')
  return turno
}

/**
 * Un profesional solo tiene sentido en un servicio POR_PROFESIONAL: en los de
 * ventanilla la fila es compartida y la toma quien este libre, asi que un
 * doctor asignado ahi no tendria fila propia que llamar y las citas que se le
 * agendaran no llegarian a ninguna parte.
 */
function validarServicioDeProfesional(servicio: FilaServicio) {
  if (servicio.modoFila !== 'POR_PROFESIONAL') {
    errorDeNegocio(
      `${servicio.nombre} atiende por ventanilla (orden de llegada), asi que no lleva profesionales asignados.`,
    )
  }
}

/**
 * La cita tiene que caber en la parrilla: franja real, jornada del doctor y
 * cupo libre.
 *
 * Vive suelta (y no dentro de `crearCita`) porque REPROGRAMAR es volver a
 * agendar y tiene que pasar por exactamente lo mismo. Con las reglas
 * duplicadas, mover una cita seria la puerta de atras para meter pacientes
 * fuera de horario o dos en el mismo cupo.
 */
async function validarFranjaDeCita(
  params: { horaCita: string; profesional: FilaProfesional; ignorarCitaId?: string },
  ctx: Ctx = prisma,
) {
  const { horaCita, profesional, ignorarCitaId } = params

  if (Number.isNaN(new Date(horaCita).getTime())) errorDeNegocio('La hora de la cita no es valida.')

  // No se agenda en un dia que ya paso: esas citas nacen muertas, nadie va a
  // registrar esa llegada y se quedan en PROGRAMADA para siempre contando como
  // inasistencia. Se compara el DIA y no la hora exacta, porque agendar a una
  // hora ya pasada de HOY si es una operacion normal del mostrador (el
  // paciente que llega tarde).
  const diaDeLaCita = diaColombia(horaCita)
  if (diaDeLaCita < diaColombia(ahoraISO())) {
    errorDeNegocio(`El ${diaDeLaCita} ya paso. Elige la fecha de hoy o una posterior.`)
  }

  const configuracion = await cargarConfiguracion(ctx)
  const hora = horaColombia(horaCita)
  const bloque = bloqueDeFranja(hora, configuracion)
  if (!bloque) {
    errorDeNegocio(
      `Las ${hora} no son una hora de consulta. Las citas van cada ${configuracion.duracionCitaMinutos} minutos, de ${configuracion.jornadaMananaInicio} a ${configuracion.jornadaMananaFin} y de ${configuracion.jornadaTardeInicio} a ${configuracion.jornadaTardeFin}.`,
    )
  }

  if (!atiendeEnJornada(profesional, bloque)) {
    errorDeNegocio(
      `${profesional.nombre} atiende en ${ETIQUETA_JORNADA[profesional.jornada]}, asi que no se le puede agendar a las ${hora}.`,
    )
  }

  const ocupada = await ctx.cita.findFirst({
    where: {
      id: ignorarCitaId ? { not: ignorarCitaId } : undefined,
      profesionalId: profesional.id,
      estado: { not: 'CANCELADA' },
      fecha: diaDeLaCita,
      horaCita: new Date(horaCita),
    },
    select: { id: true },
  })
  if (ocupada) {
    errorDeNegocio(`${profesional.nombre} ya tiene un paciente a las ${hora}. Elige otra hora.`)
  }
}

/**
 * Un doctor solo puede llamar en un consultorio que sea suyo.
 *
 * Sin esto el `moduloId` viaja en el cuerpo de la peticion sin que nadie lo
 * contraste con quien la manda, y basta un id equivocado para llamar en la
 * puerta de otro. No es solo un numero mal puesto en la pantalla: al llamar,
 * `cerrarAtencionAbierta` da por ATENDIDO al paciente que ese consultorio
 * tuviera adentro, asi que un doctor le cerraria la atencion a otro sin
 * enterarse ninguno de los dos.
 */
async function validarModuloParaLlamar(modulo: FilaModulo, profesionalId?: string, ctx: Ctx = prisma) {
  if (!modulo.activo) {
    errorDeNegocio(`${modulo.nombre} esta desactivado; no se puede llamar desde ahi.`)
  }
  if (!profesionalId) return

  const profesional = await exigirProfesional(profesionalId, ctx)

  if (modulo.servicioId && modulo.servicioId !== profesional.servicioId) {
    const servicio = await exigirServicio(profesional.servicioId, ctx)
    errorDeNegocio(`${modulo.nombre} no pertenece a ${servicio.nombre}. Pide que te asignen tu consultorio.`)
  }

  // Solo cuenta lo que esta pasando HOY. Un turno se queda en LLAMADO hasta
  // que alguien lo cierra, y al final de la jornada es normal que el ultimo
  // quede abierto: el doctor termina y se va. Sin acotarlo al dia, ese turno
  // colgado de ayer dejaria el consultorio bloqueado para siempre.
  const ocupadoPorOtro = await ctx.turno.findFirst({
    where: {
      moduloId: modulo.id,
      fecha: diaColombia(ahoraISO()),
      estado: { in: ['LLAMADO', 'EN_ATENCION'] },
      horaLlamado: { not: null },
      profesionalId: { not: null, notIn: [profesionalId] },
    },
    include: { profesional: { select: { nombre: true } } },
  })
  if (ocupadoPorOtro) {
    errorDeNegocio(
      `${modulo.nombre} lo esta usando ${ocupadoPorOtro.profesional?.nombre ?? 'otro profesional'} en este momento (turno ${ocupadoPorOtro.codigo}).`,
    )
  }
}

/**
 * Un turno solo se cierra si esta siendo atendido.
 *
 * Sin esta comprobacion se podia dar por atendido a alguien que seguia en la
 * fila sin haber sido llamado (desaparece de la cola y nadie se entera), y
 * volver a cerrar uno ya cerrado, que le reescribia la hora de atencion y
 * ensuciaba los promedios del informe.
 */
function exigirTurnoEnAtencion(turno: FilaTurno, accion: 'atendido' | 'ausente') {
  if (turno.estado === 'LLAMADO' || turno.estado === 'EN_ATENCION') return
  if (turno.estado === 'EN_ESPERA') errorDeNegocio(`El turno ${turno.codigo} todavia no ha sido llamado.`)
  errorDeNegocio(`El turno ${turno.codigo} ya esta cerrado; no se puede marcar como ${accion}.`)
}

/**
 * Siguiente codigo del servicio, EMPEZANDO DE NUEVO CADA DIA.
 *
 * El numero sale de contar los turnos que ese prefijo ya lleva hoy, en vez de
 * un contador guardado: asi no hay dos sitios que puedan discrepar, y el
 * reinicio diario es automatico. En una sala de espera el turno tiene que ser
 * un numero corto y del dia; con un contador que no se reinicia, al tercer dia
 * se estaria llamando el C-247, que no le dice nada a nadie.
 *
 * La carrera entre dos llegadas simultaneas la corta el indice unico
 * (fecha, codigo): si dos sacan el mismo numero, una falla y `crearTurno`
 * vuelve a intentarlo con el siguiente.
 */
async function siguienteCodigo(prefijo: string, fecha: string, ctx: Ctx) {
  const usados = await ctx.turno.count({ where: { fecha, codigo: { startsWith: `${prefijo}-` } } })
  return `${prefijo}-${String(usados + 1).padStart(3, '0')}`
}

const CHOQUE_DE_UNICO = 'P2002'

function esChoqueDeUnico(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === CHOQUE_DE_UNICO
}

/**
 * Crea el turno resolviendo el choque de codigos.
 *
 * Dos pacientes registrados en el mismo instante pueden calcular el mismo
 * numero. En vez de bloquear la tabla —que frenaria admisiones entera por un
 * caso que pasa poco—, se intenta insertar y, si el indice unico lo rechaza, se
 * vuelve a contar. Con pocos intentos basta: cada vuelta ya ve el turno del
 * otro.
 */
async function crearTurno(
  datos: Omit<Prisma.TurnoUncheckedCreateInput, 'codigo'>,
  prefijo: string,
  ctx: Ctx,
): Promise<FilaTurno> {
  for (let intento = 0; intento < 5; intento += 1) {
    const codigo = await siguienteCodigo(prefijo, datos.fecha, ctx)
    try {
      return await ctx.turno.create({ data: { ...datos, codigo } })
    } catch (error) {
      if (!esChoqueDeUnico(error) || intento === 4) throw error
    }
  }
  // Inalcanzable: el bucle o devuelve o lanza.
  throw new Error('No se pudo asignar un codigo de turno.')
}

/**
 * Cierra la atencion que siguiera abierta en un modulo.
 *
 * Cuando el profesional pulsa "siguiente" esta diciendo, implicitamente, que
 * termino con el anterior (seccion 22, pasos 9 y 10). Queda marcado como
 * cierre AUTOMATICO: un paciente que se levanto y se fue no puede verse en el
 * historico igual que una atencion que el doctor dio por terminada.
 */
async function cerrarAtencionAbierta(
  moduloId: string,
  exceptoTurnoId: string,
  profesionalId: string | undefined,
  ctx: Ctx,
) {
  const instante = new Date()

  const abiertos = await ctx.turno.findMany({
    where: {
      moduloId,
      id: { not: exceptoTurnoId },
      estado: { in: ['LLAMADO', 'EN_ATENCION'] },
      // Nunca se cierra el paciente de otro profesional. `validarModuloParaLlamar`
      // ya lo impide antes de llegar aqui; se repite porque este cierre es
      // silencioso, y equivocarse deja a alguien marcado como atendido sin que
      // nadie lo haya atendido.
      ...(profesionalId ? { OR: [{ profesionalId: null }, { profesionalId }] } : {}),
    },
    select: { id: true, citaId: true },
  })
  if (abiertos.length === 0) return

  await ctx.turno.updateMany({
    where: { id: { in: abiertos.map((t) => t.id) } },
    data: {
      estado: 'ATENDIDO',
      horaAtencion: instante,
      cerradoEn: instante,
      cerradoPor: null,
      cierreAutomatico: true,
    },
  })

  const citas = abiertos.map((t) => t.citaId).filter((id): id is string => Boolean(id))
  if (citas.length > 0) {
    await ctx.cita.updateMany({ where: { id: { in: citas } }, data: { estado: 'ATENDIDA' } })
  }
}

/** Traduce el estado del TURNO al estado que ve el doctor en su agenda. */
function estadoAgendaDe(turno: FilaTurno | undefined): EstadoAgendaItem {
  if (!turno) return 'PROGRAMADA'
  switch (turno.estado) {
    case 'EN_ESPERA':
      return 'EN_ESPERA'
    case 'LLAMADO':
      return 'LLAMADO'
    case 'EN_ATENCION':
      return 'EN_ATENCION'
    case 'ATENDIDO':
      return 'ATENDIDA'
    // Un turno cancelado no tiene flujo hoy, pero si lo tuviera es mas honesto
    // mostrarlo como ausente que como "programada".
    default:
      return 'AUSENTE'
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

// ---------------------------------------------------------------------------

export class PrismaTurnoRepository implements TurnoRepository {
  // --- Catalogos ---

  async listarServicios(incluirInactivos = false): Promise<Servicio[]> {
    const filas = await prisma.servicio.findMany({
      where: incluirInactivos ? undefined : { activo: true },
      orderBy: { nombre: 'asc' },
    })
    return filas.map(aServicio)
  }

  async listarModulos(servicioId?: string, incluirInactivos = false): Promise<Modulo[]> {
    const filas = await prisma.modulo.findMany({
      where: {
        ...(incluirInactivos ? {} : { activo: true }),
        // Un modulo sin servicio (ventanilla suelta) vale para cualquiera, y
        // por eso entra tambien cuando se filtra por servicio.
        ...(servicioId ? { OR: [{ servicioId }, { servicioId: null }] } : {}),
      },
      orderBy: { nombre: 'asc' },
    })
    return filas.map(aModulo)
  }

  async listarProfesionales(servicioId?: string, incluirInactivos = false): Promise<Profesional[]> {
    const filas = await prisma.profesional.findMany({
      where: {
        ...(incluirInactivos ? {} : { activo: true }),
        ...(servicioId ? { servicioId } : {}),
      },
      orderBy: { nombre: 'asc' },
    })
    return filas.map(aProfesional)
  }

  async profesionalDeUsuario(usuarioId: string): Promise<Profesional | null> {
    const fila = await prisma.profesional.findFirst({ where: { usuarioId, activo: true } })
    return fila ? aProfesional(fila) : null
  }

  // --- Agenda de citas ---

  async listarCitas(filtro: { fecha?: string; profesionalId?: string } = {}): Promise<Cita[]> {
    const filas = await prisma.cita.findMany({
      where: {
        estado: { not: 'CANCELADA' },
        ...(filtro.fecha ? { fecha: filtro.fecha } : {}),
        ...(filtro.profesionalId ? { profesionalId: filtro.profesionalId } : {}),
      },
      orderBy: { horaCita: 'asc' },
    })
    return filas.map(aCita)
  }

  async crearCita(datos: {
    documentoPaciente: string
    nombrePaciente: string
    profesionalId: string
    horaCita: string
    usuarioId?: string
  }): Promise<Cita> {
    const profesional = await exigirProfesional(datos.profesionalId)
    if (!profesional.activo) errorDeNegocio('El profesional esta inactivo.')

    const documento = datos.documentoPaciente.trim()
    const nombre = datos.nombrePaciente.trim()
    if (!documento) errorDeNegocio('Ingresa el documento del paciente.')
    if (!nombre) errorDeNegocio('Ingresa el nombre del paciente.')
    if (Number.isNaN(new Date(datos.horaCita).getTime())) errorDeNegocio('La hora de la cita no es valida.')

    // Las mismas reglas que `reprogramarCita`, que es volver a agendar: si al
    // servicio se le cambio el modo de fila, aqui no se cuela una cita para un
    // servicio que atiende por orden de llegada.
    validarServicioDeProfesional(await exigirServicio(profesional.servicioId))
    await validarFranjaDeCita({ horaCita: datos.horaCita, profesional })

    const fila = await prisma.cita.create({
      data: {
        documentoPaciente: documento,
        nombrePaciente: nombre,
        profesionalId: profesional.id,
        servicioId: profesional.servicioId,
        horaCita: new Date(datos.horaCita),
        fecha: diaColombia(datos.horaCita),
        estado: 'PROGRAMADA',
        origen: 'MANUAL',
        creadaPor: datos.usuarioId ?? null,
      },
    })
    return aCita(fila)
  }

  async cancelarCita(citaId: string, datos: { usuarioId?: string; motivo?: string } = {}): Promise<Cita> {
    const cita = await prisma.cita.findUnique({ where: { id: citaId } })
    if (!cita) errorDeNegocio('La cita indicada no existe.')
    // Si el paciente ya llego, cancelarla dejaria un turno huerfano en la fila.
    if (cita.estado === 'PRESENTADO') errorDeNegocio('El paciente ya registro su llegada; no se puede cancelar.')
    if (cita.estado === 'CANCELADA') errorDeNegocio('Esta cita ya estaba cancelada.')
    if (cita.estado === 'ATENDIDA') errorDeNegocio('Esta cita ya fue atendida; no se puede cancelar.')

    const fila = await prisma.cita.update({
      where: { id: citaId },
      data: {
        estado: 'CANCELADA',
        // Quien, cuando y por que: los dos datos con los que se le responde
        // despues al paciente que viene a reclamar.
        canceladaEn: new Date(),
        canceladaPor: datos.usuarioId ?? null,
        motivoCancelacion: datos.motivo?.trim() || null,
      },
    })
    return aCita(fila)
  }

  async reprogramarCita(
    citaId: string,
    datos: { horaCita: string; profesionalId?: string; motivo?: string; usuarioId?: string },
  ): Promise<Cita> {
    const cita = await prisma.cita.findUnique({ where: { id: citaId } })
    if (!cita) errorDeNegocio('La cita indicada no existe.')
    if (cita.estado === 'CANCELADA') errorDeNegocio('La cita fue cancelada; no se puede reprogramar.')
    if (cita.estado === 'ATENDIDA') errorDeNegocio('La cita ya fue atendida; no se puede reprogramar.')
    if (cita.estado === 'PRESENTADO') {
      // El paciente ya llego y su cita genero turno: moverla dejaria el turno
      // colgado de una hora que ya no existe. Vale tambien cuando el turno se
      // cerro como AUSENTE, porque sigue apuntando a esta cita en el historico.
      errorDeNegocio(
        'Este paciente ya registro su llegada y su cita genero turno, asi que no se puede mover. Agendale una cita nueva.',
      )
    }

    const profesional = await exigirProfesional(datos.profesionalId ?? cita.profesionalId)
    if (!profesional.activo) errorDeNegocio('El profesional esta inactivo.')
    validarServicioDeProfesional(await exigirServicio(profesional.servicioId))

    await validarFranjaDeCita({
      horaCita: datos.horaCita,
      profesional,
      // Mover a alguien a la hora que ya tiene no puede fallar por chocar
      // consigo mismo.
      ignorarCitaId: cita.id,
    })

    const fila = await prisma.cita.update({
      where: { id: citaId },
      data: {
        // La ORIGINAL es la primera de todas, no la anterior: lo que hay que
        // poder reconstruir es a que hora se le dijo al paciente que viniera
        // la primera vez, por muchas veces que se le haya movido despues.
        horaCitaOriginal: cita.horaCitaOriginal ?? cita.horaCita,
        horaCita: new Date(datos.horaCita),
        fecha: diaColombia(datos.horaCita),
        profesionalId: profesional.id,
        servicioId: profesional.servicioId,
        vecesReprogramada: { increment: 1 },
        reprogramadaEn: new Date(),
        reprogramadaPor: datos.usuarioId ?? null,
        motivoReprogramacion: datos.motivo?.trim() || null,
      },
    })
    return aCita(fila)
  }

  /**
   * El horario del dia, listo para pintar.
   *
   * Se traen las citas del dia UNA vez y se van colocando en su celda; lo que
   * no cae en ninguna queda en `fueraDeHorario` en vez de perderse. Ese caso no
   * es raro: pasa cada vez que se cambia la duracion de la consulta, se mueve
   * el horario de una jornada o se le cambia la jornada a un doctor que ya
   * tenia pacientes agendados. Y un paciente que desaparece de la agenda igual
   * se presenta en el hospital.
   */
  async horarioDelDia(fecha: string): Promise<HorarioDia> {
    const [configuracion, citasDelDia, profesionales, servicios, modulos] = await Promise.all([
      cargarConfiguracion(),
      prisma.cita.findMany({
        where: { fecha, estado: { not: 'CANCELADA' } },
        orderBy: { horaCita: 'asc' },
      }),
      prisma.profesional.findMany({ where: { activo: true } }),
      prisma.servicio.findMany(),
      prisma.modulo.findMany(),
    ])

    const { duracionCitaMinutos } = configuracion
    const servicioPorId = new Map(servicios.map((s) => [s.id, s]))
    const moduloPorId = new Map(modulos.map((m) => [m.id, m]))

    const enHorario = (cita: FilaCita): CitaEnHorario => ({
      id: cita.id,
      documentoPaciente: cita.documentoPaciente,
      nombrePaciente: cita.nombrePaciente,
      profesionalId: cita.profesionalId,
      hora: horaColombia(cita.horaCita),
      horaCita: cita.horaCita.toISOString(),
      estado: cita.estado,
      vecesReprogramada: cita.vecesReprogramada,
      horaCitaOriginal: iso(cita.horaCitaOriginal),
    })

    const colocadas = new Set<string>()

    // A QUE JORNADA PERTENECE CADA DOCTOR HOY, segun las horas a las que tiene
    // pacientes. Hace falta antes de repartir las citas por los dos bloques,
    // porque la hora del almuerzo no es de nadie: las 12:20 del doctor que
    // atiende de 12:20 a 16:14 son su tarde, y las del que atiende de 7 a 12:30
    // son su mañana. Sin esto, las primeras caian en la mañana, donde ese doctor
    // no tiene columna, y sus pacientes se iban de la parrilla.
    const jornadaDelDoctor = new Map<string, Jornada | null>()
    {
      const horasPorDoctor = new Map<string, string[]>()
      for (const cita of citasDelDia) {
        const hora = horaColombia(cita.horaCita)
        const horas = horasPorDoctor.get(cita.profesionalId)
        if (horas) horas.push(hora)
        else horasPorDoctor.set(cita.profesionalId, [hora])
      }
      for (const [id, horas] of horasPorDoctor) {
        jornadaDelDoctor.set(id, jornadaSegunHoras(horas, configuracion))
      }
    }

    const definicion = [
      {
        jornada: 'MANANA' as const,
        etiqueta: 'Jornada de la mañana',
        desde: configuracion.jornadaMananaInicio,
        hasta: configuracion.jornadaMananaFin,
      },
      {
        jornada: 'TARDE' as const,
        etiqueta: 'Jornada de la tarde',
        desde: configuracion.jornadaTardeInicio,
        hasta: configuracion.jornadaTardeFin,
      },
    ]

    const bloques: BloqueHorario[] = definicion.map(({ jornada, etiqueta, desde, hasta }) => {
      const franjas = new Set(franjasDeJornada(desde, hasta, duracionCitaMinutos))

      // Solo doctores de servicios que atienden POR CITA, ordenados por
      // servicio y nombre para que la parrilla se lea siempre igual y no baile
      // cuando se agrega un doctor nuevo.
      const doctores = profesionales
        .filter((p) => atiendeEnJornada(p, jornada))
        .filter((p) => servicioPorId.get(p.servicioId)?.modoFila === 'POR_PROFESIONAL')
        .sort((a, b) => {
          const servicioA = servicioPorId.get(a.servicioId)?.nombre ?? ''
          const servicioB = servicioPorId.get(b.servicioId)?.nombre ?? ''
          return servicioA.localeCompare(servicioB, 'es') || a.nombre.localeCompare(b.nombre, 'es')
        })

      const idsDeDoctores = new Set(doctores.map((d) => d.id))

      const citas: Record<string, CitaEnHorario[]> = {}
      const citasPorDoctor = new Map<string, number>()
      // Las horas de la jornada: las franjas configuradas MAS la hora exacta de
      // cada cita. Es lo que hace que la agenda del hospital quepa: sus citas
      // vienen a las 7:09 y a las 7:13, y una rejilla fija las expulsaba.
      const horas = new Set(franjas)

      for (const cita of citasDelDia) {
        const hora = horaColombia(cita.horaCita)
        if (!idsDeDoctores.has(cita.profesionalId)) continue
        if (bloqueDeCita(hora, configuracion, jornadaDelDoctor.get(cita.profesionalId) ?? null) !== jornada) {
          continue
        }

        horas.add(hora)
        const clave = `${cita.profesionalId}|${hora}`
        // Dos pacientes a la misma hora con el mismo doctor caben los dos: si
        // el hospital los cito asi, los dos se presentan.
        ;(citas[clave] ??= []).push(enHorario(cita))
        citasPorDoctor.set(cita.profesionalId, (citasPorDoctor.get(cita.profesionalId) ?? 0) + 1)
        colocadas.add(cita.id)
      }

      const filas = [...horas]
        .sort((a, b) => a.localeCompare(b))
        .map((hora) => ({ hora, agendable: franjas.has(hora) }))

      const columnas: ColumnaHorario[] = doctores.map((doctor) => ({
        profesionalId: doctor.id,
        profesionalNombre: doctor.nombre,
        servicioNombre: servicioPorId.get(doctor.servicioId)?.nombre ?? '—',
        moduloNombre: doctor.moduloId ? (moduloPorId.get(doctor.moduloId)?.nombre ?? null) : null,
        citas: citasPorDoctor.get(doctor.id) ?? 0,
      }))

      return { jornada, etiqueta, desde, hasta, filas, columnas, citas }
    })

    return {
      fecha,
      duracionCitaMinutos,
      bloques,
      fueraDeHorario: citasDelDia
        .filter((c) => !colocadas.has(c.id))
        .map(enHorario)
        .sort((a, b) => a.hora.localeCompare(b.hora)),
    }
  }

  /**
   * TEMPORAL (solo el panel de simulacion de carga, que va tras
   * TURNOS_SIMULACION): deja el dia sin turnos y devuelve las citas de hoy a
   * PROGRAMADA.
   *
   * A DIFERENCIA DE LA VERSION EN MEMORIA, NO BORRA NI INVENTA CITAS. Aqui las
   * citas del dia son las que subio el hospital en su reporte: borrarlas para
   * volver a sembrar unas de ejemplo destruiria la agenda real de la jornada.
   * Lo que se rehace es el recorrido del turno, que es lo unico que la
   * simulacion necesita repetir.
   */
  async reiniciarDatosDeHoy(): Promise<void> {
    const hoy = diaColombia(ahoraISO())

    await prisma.$transaction([
      prisma.turno.deleteMany({ where: { fecha: hoy } }),
      prisma.cita.updateMany({
        where: { fecha: hoy, estado: { in: ['PRESENTADO', 'ATENDIDA'] } },
        data: { estado: 'PROGRAMADA' },
      }),
    ])
  }

  // --- Admisiones ---

  /**
   * Citas de UN DIA de un paciente (por defecto hoy), para registrar su
   * llegada.
   *
   * Acotado al dia a proposito: admisiones las muestra solo con la hora
   * ("09:00"), asi que una cita de la semana entrante se veria igual que una
   * de hoy y se le podria registrar la llegada. El paciente entraria a la fila
   * de un dia que no es el suyo y le quemaria la cita.
   */
  async buscarCitasPorDocumento(documento: string, fecha?: string): Promise<Cita[]> {
    const buscado = documento.trim()
    if (!buscado) return []

    const filas = await prisma.cita.findMany({
      where: {
        documentoPaciente: buscado,
        estado: { not: 'CANCELADA' },
        fecha: fecha ?? diaColombia(ahoraISO()),
      },
      orderBy: { horaCita: 'asc' },
    })
    return filas.map(aCita)
  }

  /**
   * Citas del paciente en OTROS dias, solo para informar.
   *
   * Sin esto, al que se equivoca de dia se le responde "sin citas para ese
   * documento" y la pantalla sugiere mandarlo a la fila de ventanilla, que es
   * peor que no responder nada. Solo las que ESTAN POR VENIR: una cita pasada
   * que se quedo en PROGRAMADA es una inasistencia vieja, y decirle "su cita
   * es el martes" cuando ese martes ya paso lo manda a esperar un dia que no
   * existe.
   */
  async otrasCitasDelPaciente(documento: string, fecha?: string): Promise<Cita[]> {
    const buscado = documento.trim()
    if (!buscado) return []

    const filas = await prisma.cita.findMany({
      where: {
        documentoPaciente: buscado,
        estado: 'PROGRAMADA',
        fecha: { gt: fecha ?? diaColombia(ahoraISO()) },
      },
      orderBy: { horaCita: 'asc' },
    })
    return filas.map(aCita)
  }

  async registrarLlegada(citaId: string): Promise<Turno> {
    const cita = await prisma.cita.findUnique({ where: { id: citaId } })
    if (!cita) errorDeNegocio('La cita indicada no existe.')
    if (cita.estado === 'CANCELADA') errorDeNegocio('La cita fue cancelada.')
    if (cita.estado !== 'PROGRAMADA') errorDeNegocio('Esta cita ya registro la llegada del paciente.')

    // Ultima defensa: aunque la busqueda solo ofrezca las citas de hoy, el id
    // llega en el cuerpo de la peticion. Una llegada registrada contra una cita
    // de otro dia mete al paciente en la fila equivocada y deja el turno
    // contado en el dia que no es.
    const hoy = diaColombia(ahoraISO())
    if (cita.fecha !== hoy) {
      errorDeNegocio(
        `Esta cita no es de hoy, es del ${cita.fecha}. Solo se puede registrar la llegada el mismo dia de la cita.`,
      )
    }

    // Ultima defensa, igual que la del dia: el doctor de la cita tiene que
    // seguir activo. Si lo dieron de baja, su enlace de consultorio ya no sirve
    // y no puede llamar a nadie: meter a este paciente en su fila seria dejarlo
    // esperando un llamado que no va a llegar nunca, sin que ninguna pantalla
    // lo advierta. Mejor que admisiones se entere ahora, con el paciente
    // delante, y le resuelva la cita.
    const profesional = await prisma.profesional.findUnique({ where: { id: cita.profesionalId } })
    if (!profesional?.activo) {
      errorDeNegocio(
        'El profesional de esta cita ya no esta activo, asi que no podria llamar al paciente. Reasignale la cita a otro profesional.',
      )
    }

    const servicio = await exigirServicio(cita.servicioId)

    const turno = await prisma.$transaction(async (tx) => {
      // El paso a PRESENTADO va condicionado al estado, no a "leerlo y luego
      // escribirlo": si dos ventanillas registran al mismo paciente a la vez,
      // solo una de las dos avanza y la otra recibe un aviso claro en vez de
      // generarle un segundo turno.
      const marcada = await tx.cita.updateMany({
        where: { id: cita.id, estado: 'PROGRAMADA' },
        data: { estado: 'PRESENTADO' },
      })
      if (marcada.count === 0) errorDeNegocio('Esta cita ya registro la llegada del paciente.')

      return crearTurno(
        {
          servicioId: servicio.id,
          estado: 'EN_ESPERA',
          prioridad: 'NORMAL',
          fecha: hoy,
          vecesLlamado: 0,
          citaId: cita.id,
          profesionalId: cita.profesionalId,
          nombrePaciente: cita.nombrePaciente,
          horaCita: cita.horaCita,
        },
        servicio.prefijo,
        tx,
      )
    })

    return aTurno(turno)
  }

  async comprobanteDeLlegada(turnoId: string): Promise<ComprobanteLlegada> {
    const turno = await prisma.turno.findUnique({
      where: { id: turnoId },
      include: { servicio: true, profesional: true, modulo: true },
    })
    if (!turno) errorDeNegocio('El turno indicado no existe.')

    // El consultorio sale del turno si ya lo llamaron; si todavia esta en
    // espera, del consultorio habitual del doctor, que es el dato con el que se
    // puede orientar al paciente en ese momento. Si el doctor se mueve de
    // consultorio ese dia, manda lo que muestre la pantalla al llamarlo.
    let moduloNombre = turno.modulo?.nombre ?? null
    if (!moduloNombre && turno.profesional?.moduloId) {
      const habitual = await prisma.modulo.findUnique({ where: { id: turno.profesional.moduloId } })
      moduloNombre = habitual?.nombre ?? null
    }

    return {
      turnoId: turno.id,
      codigo: turno.codigo,
      servicioNombre: turno.servicio.nombre,
      profesionalNombre: turno.profesional?.nombre ?? null,
      moduloNombre,
      horaCita: iso(turno.horaCita),
      nombrePaciente: turno.nombrePaciente,
    }
  }

  async generarTurnoDeVentanilla(servicioId: string): Promise<Turno> {
    const servicio = await exigirServicio(servicioId)
    if (servicio.modoFila !== 'COMPARTIDA') {
      errorDeNegocio('Este servicio atiende por cita: el turno se genera al registrar la llegada del paciente.')
    }

    const turno = await crearTurno(
      {
        servicioId: servicio.id,
        estado: 'EN_ESPERA',
        prioridad: 'NORMAL',
        fecha: diaColombia(ahoraISO()),
        vecesLlamado: 0,
      },
      servicio.prefijo,
      prisma,
    )
    return aTurno(turno)
  }

  /**
   * Agenda del dia de un profesional. Parte de las CITAS (no de los turnos)
   * para que una cita que aun no genero turno —el paciente no ha llegado—
   * siga siendo visible para el doctor en vez de desaparecer: asi entiende por
   * que no puede llamar a alguien que ve en su lista.
   */
  async agendaProfesional(profesionalId: string, fecha: string): Promise<ItemAgendaProfesional[]> {
    await exigirProfesional(profesionalId)
    if (!esFechaValida(fecha)) errorDeNegocio('La fecha no es valida.')

    const citas = await prisma.cita.findMany({
      where: { profesionalId, fecha, estado: { not: 'CANCELADA' } },
      orderBy: { horaCita: 'asc' },
      include: { turnos: { orderBy: { fechaGeneracion: 'desc' }, take: 1 } },
    })

    return citas.map((cita) => {
      const turno = cita.turnos[0]
      return {
        citaId: cita.id,
        turnoId: turno?.id ?? null,
        documentoPaciente: cita.documentoPaciente,
        nombrePaciente: cita.nombrePaciente,
        horaCita: cita.horaCita.toISOString(),
        estado: estadoAgendaDe(turno),
        codigo: turno?.codigo ?? null,
        vecesLlamado: turno?.vecesLlamado ?? 0,
        cierreAutomatico: turno?.cierreAutomatico ?? false,
      }
    })
  }

  // --- Operacion ---

  /**
   * Turnos en espera de una fila, en el orden en que hay que atenderlos.
   *
   * SOLO LOS DE HOY. Un turno se queda EN_ESPERA hasta que alguien lo llama, y
   * al cerrar la jornada es normal que queden pacientes sin llamar. Sin este
   * filtro esos turnos siguen en la cola al dia siguiente y, como la cola se
   * ordena por hora de generacion, quedan DE PRIMEROS: el doctor pulsa
   * "siguiente" a primera hora y el sistema llama a un paciente de ayer, que no
   * esta en la sala, mientras los de hoy esperan detras. Los turnos viejos no
   * se borran: siguen en el historico con su estado real.
   */
  async listarPendientes(filtro: { servicioId?: string; profesionalId?: string }): Promise<Turno[]> {
    const filas = await prisma.turno.findMany({
      where: {
        estado: 'EN_ESPERA',
        fecha: diaColombia(ahoraISO()),
        ...(filtro.servicioId ? { servicioId: filtro.servicioId } : {}),
        ...(filtro.profesionalId ? { profesionalId: filtro.profesionalId } : {}),
      },
      orderBy: [{ prioridad: 'desc' }, { fechaGeneracion: 'asc' }],
    })
    // `prioridad: 'desc'` ya pone PRIORITARIO antes que NORMAL por el orden del
    // enum, pero se reordena con la misma funcion que usa el resto del sistema
    // para que la regla viva en un solo sitio.
    return filas.map(aTurno).sort(ordenAtencion)
  }

  /**
   * Si ese turno es de ese profesional: la comprobacion que impide que un
   * doctor cierre el turno de otro cambiando el id en la URL de su enlace.
   */
  async turnoEsDelProfesional(turnoId: string, profesionalId: string): Promise<boolean> {
    const turno = await prisma.turno.findFirst({
      where: { id: turnoId, profesionalId },
      select: { id: true },
    })
    return Boolean(turno)
  }

  /** El paciente que el profesional tiene AHORA al frente: su ultimo turno del dia LLAMADO o EN_ATENCION. */
  async turnoEnAtencion(profesionalId: string, fecha: string): Promise<Turno | null> {
    const fila = await prisma.turno.findFirst({
      where: { profesionalId, fecha, estado: { in: ['LLAMADO', 'EN_ATENCION'] } },
      orderBy: { horaLlamado: 'desc' },
    })
    return fila ? aTurno(fila) : null
  }

  async llamarSiguiente(params: {
    servicioId?: string
    profesionalId?: string
    moduloId: string
    funcionarioId: string
  }): Promise<Turno | null> {
    if (!params.servicioId && !params.profesionalId) {
      errorDeNegocio('Debes indicar el servicio o el profesional.')
    }

    const modulo = await exigirModulo(params.moduloId)
    await validarModuloParaLlamar(modulo, params.profesionalId)

    const candidatos = await this.listarPendientes({
      servicioId: params.servicioId,
      profesionalId: params.profesionalId,
    })

    for (const candidato of candidatos) {
      const instante = new Date()

      // RECLAMAR, no "leer y escribir". El update solo prospera si el turno
      // SIGUE en espera: si otro consultorio se lo llevo entre la consulta y
      // esta linea, afecta cero filas y se pasa al siguiente de la cola. Sin
      // esto, dos doctores pulsando "siguiente" a la vez llaman al mismo
      // paciente, que es un error que en la sala de espera se ve y se oye.
      const reclamado = await prisma.turno.updateMany({
        where: { id: candidato.id, estado: 'EN_ESPERA' },
        data: {
          estado: 'LLAMADO',
          moduloId: modulo.id,
          funcionarioId: params.funcionarioId,
          horaLlamado: instante,
          vecesLlamado: { increment: 1 },
        },
      })
      if (reclamado.count === 0) continue

      // El PRIMER llamado se graba una sola vez y ya no se toca: es contra el
      // que se mide la espera del paciente (ver `horaPrimerLlamado` en
      // `types.ts`). Va aparte porque `updateMany` no sabe hacer "solo si esta
      // vacio".
      await prisma.turno.updateMany({
        where: { id: candidato.id, horaPrimerLlamado: null },
        data: { horaPrimerLlamado: instante },
      })

      // Un consultorio atiende a un paciente a la vez: al llamar al siguiente,
      // el anterior de ese mismo modulo se da por atendido.
      await cerrarAtencionAbierta(modulo.id, candidato.id, params.profesionalId, prisma)

      const turno = await prisma.turno.findUniqueOrThrow({ where: { id: candidato.id } })
      realtimeHub.publish({
        tipo: 'turno.llamado',
        casilla: await casillaDeTurno(turno),
        repetido: false,
      })
      return aTurno(turno)
    }

    return null
  }

  async repetirLlamado(turnoId: string): Promise<Turno> {
    const turno = await exigirTurno(turnoId)
    if (!turno.moduloId) errorDeNegocio('El turno no ha sido llamado todavia.')

    // Solo se repite el turno que se esta atendiendo AHORA. Repetir uno ya
    // cerrado lo volvia a publicar en la pantalla: el consultorio mostraria a
    // un paciente que ya se fue, tapando al que de verdad esta adentro.
    if (turno.estado !== 'LLAMADO' && turno.estado !== 'EN_ATENCION') {
      errorDeNegocio('Ese turno ya se cerro; no se puede volver a llamar.')
    }

    const instante = new Date()
    const actualizado = await prisma.turno.update({
      where: { id: turnoId },
      data: {
        vecesLlamado: { increment: 1 },
        // Se actualiza el ULTIMO llamado (la pantalla ordena por el), nunca el
        // primero: repetir el llamado no puede reescribir cuanto espero el
        // paciente.
        horaLlamado: instante,
        horaPrimerLlamado: turno.horaPrimerLlamado ?? instante,
      },
    })

    realtimeHub.publish({
      tipo: 'turno.llamado',
      casilla: await casillaDeTurno(actualizado),
      repetido: true,
    })
    return aTurno(actualizado)
  }

  async marcarAtendido(turnoId: string, cerradoPor?: string): Promise<Turno> {
    const turno = await exigirTurno(turnoId)
    exigirTurnoEnAtencion(turno, 'atendido')

    const instante = new Date()
    const actualizado = await prisma.$transaction(async (tx) => {
      const fila = await tx.turno.update({
        where: { id: turnoId },
        data: {
          estado: 'ATENDIDO',
          horaAtencion: instante,
          cerradoEn: instante,
          cerradoPor: cerradoPor ?? null,
          cierreAutomatico: false,
        },
      })
      if (fila.citaId) {
        await tx.cita.update({ where: { id: fila.citaId }, data: { estado: 'ATENDIDA' } })
      }
      return fila
    })

    if (actualizado.moduloId) {
      realtimeHub.publish({ tipo: 'modulo.liberado', moduloId: actualizado.moduloId })
    }
    return aTurno(actualizado)
  }

  async marcarAusente(turnoId: string, cerradoPor?: string): Promise<Turno> {
    const turno = await exigirTurno(turnoId)
    exigirTurnoEnAtencion(turno, 'ausente')

    const actualizado = await prisma.turno.update({
      where: { id: turnoId },
      data: {
        estado: 'AUSENTE',
        // El ausente tambien deja hora: sin ella no se sabe cuando se le dio
        // por ausente ni cuanto se le espero, y ante un reclamo no hay nada que
        // mirar. `horaAtencion` se deja en null a proposito: a este paciente no
        // se le atendio.
        cerradoEn: new Date(),
        cerradoPor: cerradoPor ?? null,
        cierreAutomatico: false,
      },
    })

    if (actualizado.moduloId) {
      realtimeHub.publish({ tipo: 'modulo.liberado', moduloId: actualizado.moduloId })
    }
    return aTurno(actualizado)
  }

  // --- Pantalla de la sala de espera ---

  /**
   * Estado de la pantalla: una casilla por consultorio activo.
   *
   * SOLO turnos llamados HOY. Un turno queda en LLAMADO hasta que el doctor lo
   * cierra, y al final de la jornada es normal que el ultimo se quede sin
   * cerrar. Sin este filtro ese turno sigue pintado en el televisor a la
   * mañana siguiente, y el primer paciente del dia ve un numero que ya paso y
   * cree que le toca.
   */
  async estadoPantalla(): Promise<CasillaPantalla[]> {
    const hoy = diaColombia(ahoraISO())

    const [modulos, servicios, profesionales, llamados] = await Promise.all([
      prisma.modulo.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
      prisma.servicio.findMany(),
      prisma.profesional.findMany({ where: { activo: true } }),
      prisma.turno.findMany({
        where: {
          fecha: hoy,
          estado: { in: ['LLAMADO', 'EN_ATENCION'] },
          moduloId: { not: null },
          horaLlamado: { not: null },
        },
        orderBy: { horaLlamado: 'asc' },
      }),
    ])

    const servicioPorId = new Map(servicios.map((s) => [s.id, s]))
    const profesionalPorId = new Map(profesionales.map((p) => [p.id, p]))

    // El ultimo llamado de cada consultorio. La lista viene ascendente, asi que
    // el que quede en el mapa es el mas reciente.
    const ultimoPorModulo = new Map<string, FilaTurno>()
    for (const turno of llamados) ultimoPorModulo.set(turno.moduloId!, turno)

    const configuracion = await cargarConfiguracion()
    const bloqueAhora = jornadaActual(configuracion)

    return modulos.map((modulo) => {
      const turno = ultimoPorModulo.get(modulo.id)
      const servicio = turno
        ? servicioPorId.get(turno.servicioId)
        : modulo.servicioId
          ? servicioPorId.get(modulo.servicioId)
          : null

      if (turno) {
        return {
          moduloId: modulo.id,
          moduloNombre: modulo.nombre,
          servicioId: servicio?.id ?? '',
          servicioNombre: servicio?.nombre ?? 'Ventanilla',
          profesionalNombre: turno.profesionalId
            ? (profesionalPorId.get(turno.profesionalId)?.nombre ?? null)
            : null,
          turnoId: turno.id,
          codigo: turno.codigo,
          horaLlamado: iso(turno.horaLlamado),
          vecesLlamado: turno.vecesLlamado,
        }
      }

      return {
        moduloId: modulo.id,
        moduloNombre: modulo.nombre,
        servicioId: servicio?.id ?? '',
        servicioNombre: servicio?.nombre ?? 'Ventanilla',
        // Solo profesionales ACTIVOS, y de ellos EL DE LA JORNADA QUE CORRE.
        // Un consultorio suele compartirse entre un doctor de mañana y uno de
        // tarde: cogiendo el primero de la lista, el televisor mostraba al de
        // la mañana toda la tarde y el paciente entraba preguntando por alguien
        // que ya se habia ido.
        profesionalNombre: profesionalDeTurnoEn(modulo.id, profesionales, bloqueAhora)?.nombre ?? null,
        turnoId: null,
        codigo: null,
        horaLlamado: null,
        vecesLlamado: 0,
      }
    })
  }

  /**
   * Ultimos turnos llamados, en orden descendente. Alimenta la lista lateral de
   * la pantalla; util cuando varios consultorios llaman casi al tiempo y el
   * destacado principal alcanza a rotar antes de que el paciente lo vea.
   *
   * Tambien solo los de hoy: en una mañana floja, esa lista se rellenaba con
   * turnos de ayer.
   */
  async ultimosLlamados(limite = 5): Promise<CasillaPantalla[]> {
    const filas = await prisma.turno.findMany({
      where: {
        fecha: diaColombia(ahoraISO()),
        horaLlamado: { not: null },
        moduloId: { not: null },
      },
      orderBy: { horaLlamado: 'desc' },
      take: limite,
    })

    return Promise.all(filas.map((fila) => casillaDeTurno(fila)))
  }

  // --- Historico y estadisticas ---

  async historico(filtro: FiltroHistorico): Promise<Turno[]> {
    const filas = await prisma.turno.findMany({
      where: {
        ...(filtro.servicioId ? { servicioId: filtro.servicioId } : {}),
        ...(filtro.codigo ? { codigo: { contains: filtro.codigo, mode: 'insensitive' } } : {}),
        ...(filtro.estado ? { estado: filtro.estado } : {}),
        ...(filtro.moduloId ? { moduloId: filtro.moduloId } : {}),
        ...(filtro.funcionarioId ? { funcionarioId: filtro.funcionarioId } : {}),
        ...(filtro.profesionalId ? { profesionalId: filtro.profesionalId } : {}),
        ...(filtro.fecha ? { fecha: filtro.fecha } : {}),
        ...(filtro.fechaDesde || filtro.fechaHasta
          ? {
              fecha: {
                ...(filtro.fechaDesde ? { gte: filtro.fechaDesde } : {}),
                ...(filtro.fechaHasta ? { lte: filtro.fechaHasta } : {}),
              },
            }
          : {}),
      },
      orderBy: { fechaGeneracion: 'desc' },
    })
    return filas.map(aTurno)
  }

  async estadisticas(fecha: string): Promise<EstadisticasDia> {
    const [turnosDelDia, citasDelDia, servicios] = await Promise.all([
      prisma.turno.findMany({ where: { fecha } }),
      // Las citas del dia entran en el calculo para poder medir la
      // inasistencia, que no se ve en los turnos: el que no viene no genera
      // turno, asi que no existe en el historico.
      prisma.cita.findMany({ where: { fecha } }),
      prisma.servicio.findMany({ orderBy: { nombre: 'asc' } }),
    ])

    const turnos = turnosDelDia.map(aTurno)
    const citas = citasDelDia.map(aCita)

    const porFuncionario = new Map<string, number>()
    for (const turno of turnos) {
      // Se cuenta a quien CERRO la atencion, no a quien llamo, y solo si la
      // cerro alguien: los cierres automaticos no se le apuntan a nadie.
      const responsable = turno.cerradoPor ?? turno.funcionarioId
      if (turno.estado !== 'ATENDIDO' || turno.cierreAutomatico || !responsable) continue
      porFuncionario.set(responsable, (porFuncionario.get(responsable) ?? 0) + 1)
    }

    return {
      fecha,
      total: resumir('', 'Todos los servicios', turnos, citas),
      porServicio: servicios.map((servicio) =>
        resumir(
          servicio.id,
          servicio.nombre,
          turnos.filter((t) => t.servicioId === servicio.id),
          citas.filter((c) => c.servicioId === servicio.id),
        ),
      ),
      porFuncionario: [...porFuncionario.entries()]
        .map(([funcionarioId, atendidos]) => ({ funcionarioId, atendidos }))
        .sort((a, b) => b.atendidos - a.atendidos),
    }
  }

  // --- Administracion de catalogos ---

  async crearServicio(datos: Omit<Servicio, 'id'>): Promise<Servicio> {
    const prefijo = datos.prefijo.trim().toUpperCase()
    if (!prefijo) errorDeNegocio('El prefijo es obligatorio.')
    await validarPrefijoLibre(prefijo)

    const nombre = datos.nombre.trim()
    if (!nombre) errorDeNegocio('El nombre del servicio es obligatorio.')

    const fila = await prisma.servicio.create({
      data: { nombre, prefijo, modoFila: datos.modoFila, activo: datos.activo },
    })
    return aServicio(fila)
  }

  async actualizarServicio(id: string, datos: Partial<Omit<Servicio, 'id'>>): Promise<Servicio> {
    const servicio = await exigirServicio(id)
    const cambios: Prisma.ServicioUpdateInput = {}

    if (datos.prefijo && datos.prefijo.trim().toUpperCase() !== servicio.prefijo) {
      const prefijo = datos.prefijo.trim().toUpperCase()
      await validarPrefijoLibre(prefijo)
      // El numero del turno sale de contar los del dia con ese prefijo: al
      // cambiarlo, la numeracion arranca donde iba el prefijo nuevo.
      cambios.prefijo = prefijo
    }
    if (datos.nombre !== undefined) cambios.nombre = datos.nombre.trim()
    if (datos.modoFila !== undefined && datos.modoFila !== servicio.modoFila) {
      await validarCambioDeModoFila(servicio, datos.modoFila)
      cambios.modoFila = datos.modoFila
    }
    if (datos.activo !== undefined) cambios.activo = datos.activo

    const fila = await prisma.servicio.update({ where: { id }, data: cambios })
    return aServicio(fila)
  }

  /**
   * Borra un servicio que nunca llego a operar.
   *
   * Uno que ya opero NO se borra: el historico y las estadisticas buscan el
   * servicio de cada turno por su id y quedarian rotos, que es justo lo que el
   * requerimiento (seccion 18) no permite perder. Para sacarlo de circulacion
   * esta el interruptor de activo/inactivo, que ya lo esconde de las filas y de
   * la pantalla sin perder el rastro.
   */
  async eliminarServicio(id: string): Promise<void> {
    const servicio = await exigirServicio(id)

    const [turnos, citas, profesionales] = await Promise.all([
      prisma.turno.count({ where: { servicioId: id } }),
      prisma.cita.count({ where: { servicioId: id, estado: { not: 'CANCELADA' } } }),
      prisma.profesional.count({ where: { servicioId: id } }),
    ])

    if (turnos > 0) {
      errorDeNegocio(
        `${servicio.nombre} ya tiene turnos registrados, asi que no se puede eliminar. Desactivalo para dejar de usarlo sin perder el historico.`,
      )
    }
    if (citas > 0) {
      errorDeNegocio(`${servicio.nombre} tiene citas agendadas. Cancelalas o desactiva el servicio.`)
    }
    if (profesionales > 0) {
      errorDeNegocio(
        `${servicio.nombre} tiene ${profesionales} profesional(es) asignado(s). Muevelos a otro servicio antes de eliminarlo.`,
      )
    }

    await prisma.$transaction([
      // Los modulos SI se conservan: un consultorio sigue existiendo aunque el
      // servicio deje de existir, solo queda sin asignar.
      prisma.modulo.updateMany({ where: { servicioId: id }, data: { servicioId: null } }),
      prisma.servicio.delete({ where: { id } }),
    ])
  }

  async crearModulo(datos: Omit<Modulo, 'id'>): Promise<Modulo> {
    if (datos.servicioId) await exigirServicio(datos.servicioId)

    const nombre = datos.nombre.trim()
    await validarNombreDeModuloLibre(nombre)

    const fila = await prisma.modulo.create({
      data: { nombre, servicioId: datos.servicioId ?? null, activo: datos.activo },
    })
    return aModulo(fila)
  }

  async actualizarModulo(id: string, datos: Partial<Omit<Modulo, 'id'>>): Promise<Modulo> {
    await exigirModulo(id)
    if (datos.servicioId) await exigirServicio(datos.servicioId)

    const cambios: Prisma.ModuloUncheckedUpdateInput = {}
    if (datos.nombre !== undefined) {
      const nombre = datos.nombre.trim()
      await validarNombreDeModuloLibre(nombre, id)
      cambios.nombre = nombre
    }
    if (datos.servicioId !== undefined) cambios.servicioId = datos.servicioId || null
    if (datos.activo !== undefined) cambios.activo = datos.activo

    const fila = await prisma.modulo.update({ where: { id }, data: cambios })
    return aModulo(fila)
  }

  async crearProfesional(datos: {
    nombre: string
    servicioId: string
    jornada: Jornada
    moduloId?: string | null
  }): Promise<Profesional> {
    const nombre = datos.nombre.trim()
    if (!nombre) errorDeNegocio('Ingresa el nombre del profesional.')

    const servicio = await exigirServicio(datos.servicioId)
    validarServicioDeProfesional(servicio)
    if (datos.moduloId) await exigirModulo(datos.moduloId)

    const repetido = await prisma.profesional.findUnique({ where: { nombre } })
    if (repetido) errorDeNegocio(`Ya existe un profesional llamado ${nombre}.`)

    const fila = await prisma.profesional.create({
      data: {
        nombre,
        servicioId: servicio.id,
        jornada: datos.jornada,
        moduloId: datos.moduloId || null,
        activo: true,
      },
    })
    return aProfesional(fila)
  }

  async actualizarProfesional(
    id: string,
    datos: Partial<{
      nombre: string
      servicioId: string
      jornada: Jornada
      moduloId: string | null
      activo: boolean
    }>,
  ): Promise<Profesional> {
    const profesional = await exigirProfesional(id)
    const cambios: Prisma.ProfesionalUncheckedUpdateInput = {}

    if (datos.nombre !== undefined) {
      const nombre = datos.nombre.trim()
      if (!nombre) errorDeNegocio('Ingresa el nombre del profesional.')
      cambios.nombre = nombre
    }

    if (datos.servicioId !== undefined && datos.servicioId !== profesional.servicioId) {
      const servicio = await exigirServicio(datos.servicioId)
      validarServicioDeProfesional(servicio)

      // Las citas ya agendadas guardan el servicio: cambiarselo aqui las
      // dejaria apuntando al anterior. Es mas honesto pedir que se resuelva la
      // agenda primero que mover al doctor y dejar el dia torcido.
      const conCitas = await prisma.cita.count({
        where: { profesionalId: id, estado: 'PROGRAMADA' },
      })
      if (conCitas > 0) {
        const actual = await exigirServicio(profesional.servicioId)
        errorDeNegocio(
          `${profesional.nombre} tiene citas programadas en ${actual.nombre}. Atiendelas o cancelalas antes de cambiarle el servicio.`,
        )
      }
      cambios.servicioId = servicio.id
    }

    if (datos.jornada !== undefined && datos.jornada !== profesional.jornada) {
      // Cambiarle la jornada a un doctor que ya tiene pacientes citados los
      // dejaria fuera de su horario: apareceran en "fuera de horario" y nadie
      // los llamaria. Se avisa en vez de moverlo callado.
      if (datos.jornada !== 'COMPLETA') {
        const configuracion = await cargarConfiguracion()
        const citasFuturas = await prisma.cita.findMany({
          where: { profesionalId: id, estado: 'PROGRAMADA' },
          select: { horaCita: true },
        })
        const quedanFuera = citasFuturas.filter(
          (c) => bloqueDeFranja(horaColombia(c.horaCita), configuracion) !== datos.jornada,
        ).length
        if (quedanFuera > 0) {
          errorDeNegocio(
            `${profesional.nombre} tiene ${quedanFuera} cita(s) programada(s) que quedarian fuera de ${ETIQUETA_JORNADA[datos.jornada]}. Reubicalas o cancelalas antes de cambiarle la jornada.`,
          )
        }
      }
      cambios.jornada = datos.jornada
    }

    if (datos.moduloId !== undefined) {
      if (datos.moduloId) await exigirModulo(datos.moduloId)
      cambios.moduloId = datos.moduloId || null
    }

    if (datos.activo === false && profesional.activo) {
      // DAR DE BAJA A UN DOCTOR NO ES SOLO ESCONDERLO DE LAS LISTAS. Su enlace
      // de consultorio deja de servir en el acto, asi que: si tiene un paciente
      // adentro ya no puede cerrarle el turno, y ese turno se queda abierto
      // ocupando su casilla en el televisor; y sus citas siguen ahi, asi que
      // admisiones puede meter a esos pacientes en la fila de un doctor que no
      // puede llamar a nadie.
      const abiertos = await prisma.turno.count({
        where: { profesionalId: id, estado: { in: ['EN_ESPERA', 'LLAMADO', 'EN_ATENCION'] } },
      })
      if (abiertos > 0) {
        errorDeNegocio(
          `${profesional.nombre} tiene ${abiertos} paciente(s) sin cerrar. Cierra su atencion antes de darlo de baja.`,
        )
      }

      const citasPendientes = await prisma.cita.count({
        where: { profesionalId: id, estado: 'PROGRAMADA', fecha: { gte: diaColombia(ahoraISO()) } },
      })
      if (citasPendientes > 0) {
        errorDeNegocio(
          `${profesional.nombre} tiene ${citasPendientes} cita(s) programada(s) de hoy en adelante. Reubicalas o cancelalas antes de darlo de baja.`,
        )
      }
    }

    if (datos.activo !== undefined) cambios.activo = datos.activo

    const fila = await prisma.profesional.update({ where: { id }, data: cambios })
    return aProfesional(fila)
  }

  // --- Parametros generales ---

  async configuracion(): Promise<ConfiguracionSistema> {
    return cargarConfiguracion()
  }

  async guardarConfiguracion(datos: Partial<ConfiguracionSistema>): Promise<ConfiguracionSistema> {
    const actual = await cargarConfiguracion()
    const siguiente: ConfiguracionSistema = { ...actual, ...datos }

    // Las cuatro horas de las jornadas se validan JUNTAS, no campo por campo:
    // cada una por separado puede ser una hora perfectamente valida y aun asi
    // dejar un horario imposible (la tarde empezando antes de que cierre la
    // mañana, o una jornada que termina antes de abrir). Un horario incoherente
    // no revienta nada, pero deja la parrilla vacia y al operador sin entender
    // por que no puede agendar.
    const jornadas = [
      { nombre: 'la mañana', desde: siguiente.jornadaMananaInicio, hasta: siguiente.jornadaMananaFin },
      { nombre: 'la tarde', desde: siguiente.jornadaTardeInicio, hasta: siguiente.jornadaTardeFin },
    ]

    for (const jornada of jornadas) {
      const desde = aMinutos(jornada.desde)
      const hasta = aMinutos(jornada.hasta)
      if (!Number.isFinite(desde) || !Number.isFinite(hasta)) {
        errorDeNegocio(`Las horas de ${jornada.nombre} deben tener el formato HH:MM.`)
      }
      if (hasta <= desde) {
        errorDeNegocio(`La jornada de ${jornada.nombre} tiene que terminar despues de empezar.`)
      }
      if (hasta - desde < siguiente.duracionCitaMinutos) {
        errorDeNegocio(
          `En la jornada de ${jornada.nombre} no cabe ni una consulta de ${siguiente.duracionCitaMinutos} minutos.`,
        )
      }
    }

    if (aMinutos(siguiente.jornadaTardeInicio) < aMinutos(siguiente.jornadaMananaFin)) {
      errorDeNegocio('La jornada de la tarde no puede empezar antes de que termine la de la mañana.')
    }

    await prisma.configuracion.upsert({
      where: { id: ID_CONFIGURACION },
      update: siguiente,
      create: { id: ID_CONFIGURACION, ...siguiente },
    })
    return siguiente
  }

  // --- Acceso temporal de profesionales ---

  async crearAccesoProfesional(
    profesionalId: string,
    duracionMinutos: number,
  ): Promise<{ acceso: AccesoProfesional; token: string }> {
    await exigirProfesional(profesionalId)

    if (
      !Number.isInteger(duracionMinutos) ||
      duracionMinutos < MINUTOS_ACCESO_MINIMO ||
      duracionMinutos > MINUTOS_ACCESO_MAXIMO
    ) {
      errorDeNegocio(
        `La vigencia del enlace debe estar entre ${MINUTOS_ACCESO_MINIMO} minutos y ${MINUTOS_ACCESO_MAXIMO / 60} horas.`,
      )
    }

    const token = randomBytes(32).toString('base64url')

    const acceso = await prisma.$transaction(async (tx) => {
      // Un doctor, un enlace activo: el anterior deja de servir en cuanto se
      // genera uno nuevo, para que no queden varias llaves vivas sueltas.
      await tx.accesoProfesional.updateMany({
        where: { profesionalId, revocadoEn: null },
        data: { revocadoEn: new Date() },
      })

      return tx.accesoProfesional.create({
        data: {
          profesionalId,
          // El token EN CLARO no se guarda: solo su hash. Un volcado de la
          // tabla no sirve para entrar a ningun consultorio.
          tokenHash: hashToken(token),
          expiraEn: new Date(Date.now() + duracionMinutos * 60 * 1000),
        },
      })
    })

    return { acceso: aAcceso(acceso), token }
  }

  async validarAccesoProfesional(token: string): Promise<Profesional | null> {
    if (!token) return null

    const acceso = await prisma.accesoProfesional.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { profesional: true },
    })
    if (!acceso) return null
    if (acceso.revocadoEn) return null
    if (acceso.expiraEn.getTime() <= Date.now()) return null
    if (!acceso.profesional.activo) return null

    await prisma.accesoProfesional.update({
      where: { id: acceso.id },
      data: { ultimoUsoEn: new Date() },
    })
    return aProfesional(acceso.profesional)
  }

  async listarAccesosProfesional(): Promise<AccesoProfesional[]> {
    const filas = await prisma.accesoProfesional.findMany({ orderBy: { creadoEn: 'desc' } })
    return filas.map(aAcceso)
  }

  async revocarAccesoProfesional(id: string): Promise<AccesoProfesional> {
    const acceso = await prisma.accesoProfesional.findUnique({ where: { id } })
    if (!acceso) errorDeNegocio('El acceso indicado no existe.')

    if (acceso.revocadoEn) return aAcceso(acceso)

    const fila = await prisma.accesoProfesional.update({
      where: { id },
      data: { revocadoEn: new Date() },
    })
    return aAcceso(fila)
  }
}

// ---------------------------------------------------------------------------
// Ayudas que necesitan la base de datos
// ---------------------------------------------------------------------------

/** Arma la casilla que ve la pantalla publica. NO lleva datos del paciente. */
async function casillaDeTurno(turno: FilaTurno): Promise<CasillaPantalla> {
  const [modulo, servicio, profesional] = await Promise.all([
    turno.moduloId ? prisma.modulo.findUnique({ where: { id: turno.moduloId } }) : null,
    prisma.servicio.findUnique({ where: { id: turno.servicioId } }),
    turno.profesionalId ? prisma.profesional.findUnique({ where: { id: turno.profesionalId } }) : null,
  ])

  return {
    moduloId: modulo?.id ?? '',
    moduloNombre: modulo?.nombre ?? '',
    servicioId: servicio?.id ?? '',
    servicioNombre: servicio?.nombre ?? 'Ventanilla',
    profesionalNombre: profesional?.nombre ?? null,
    turnoId: turno.id,
    codigo: turno.codigo,
    horaLlamado: iso(turno.horaLlamado),
    vecesLlamado: turno.vecesLlamado,
  }
}

/**
 * En que jornada estamos AHORA, segun la hora de Colombia. Se parte por el fin
 * de la jornada de la mañana; no hace falta afinar mas, porque esto solo decide
 * que nombre de doctor se rotula en una casilla libre.
 */
function jornadaActual(configuracion: ConfiguracionSistema): 'MANANA' | 'TARDE' {
  const ahora = aMinutos(horaColombia(ahoraISO()))
  const finManana = aMinutos(configuracion.jornadaMananaFin)
  if (!Number.isFinite(ahora) || !Number.isFinite(finManana)) return 'MANANA'
  return ahora < finManana ? 'MANANA' : 'TARDE'
}

/**
 * Que doctor rotular en un consultorio que ahora mismo no esta llamando.
 *
 * Se prefiere al que atiende SOLO esa jornada antes que al de dia completo: si
 * comparten consultorio, el de jornada partida es el que esta adentro.
 */
function profesionalDeTurnoEn(
  moduloId: string,
  profesionales: FilaProfesional[],
  bloque: 'MANANA' | 'TARDE',
): FilaProfesional | undefined {
  const delModulo = profesionales.filter((p) => p.moduloId === moduloId)
  if (delModulo.length <= 1) return delModulo[0]

  return (
    delModulo.find((p) => p.jornada === bloque) ??
    delModulo.find((p) => atiendeEnJornada(p, bloque)) ??
    delModulo[0]
  )
}

/**
 * Dos consultorios no pueden llamarse igual.
 *
 * El nombre del modulo es LO UNICO que se le dice al paciente para que sepa por
 * que puerta entrar ("turno C-014, consultorio 3"), y es lo que rotula cada
 * casilla del televisor. Con dos "Consultorio 3" en la pantalla, ese dato deja
 * de identificar una puerta y el paciente no tiene forma de resolverlo. Se
 * compara sin distinguir mayusculas ni espacios de sobra, que es como lo lee
 * una persona.
 */
async function validarNombreDeModuloLibre(nombre: string, exceptoId?: string) {
  if (!nombre) errorDeNegocio('El nombre del consultorio o la ventanilla es obligatorio.')

  const repetido = await prisma.modulo.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(exceptoId ? { id: { not: exceptoId } } : {}),
    },
    select: { id: true },
  })
  if (repetido) {
    errorDeNegocio(
      `Ya existe "${nombre}". El paciente solo tiene ese nombre para saber por que puerta entrar, asi que no puede haber dos iguales.`,
    )
  }
}

async function validarPrefijoLibre(prefijo: string) {
  const repetido = await prisma.servicio.findFirst({ where: { prefijo }, select: { id: true } })
  if (repetido) errorDeNegocio(`El prefijo ${prefijo} ya lo usa otro servicio.`)
}

/**
 * El modo de fila de un servicio no se cambia con gente dentro.
 *
 * `modoFila` no es una etiqueta: decide POR DONDE entra el paciente. Cambiarlo
 * con datos vivos deja pacientes que no se pueden atender, y ninguna pantalla
 * muestra un error: simplemente no aparecen. Hacia COMPARTIDA, los doctores
 * quedan colgando de un servicio que no lleva profesionales y las citas ya
 * agendadas no se pueden mover. Hacia POR_PROFESIONAL, los turnos que estaban
 * en la fila no tienen doctor y se quedan en la cola para siempre, porque a
 * partir del cambio solo se llama por doctor.
 *
 * Para dejar de usar un servicio esta el interruptor de activo/inactivo, que no
 * rompe nada de lo que ya empezo.
 */
async function validarCambioDeModoFila(servicio: FilaServicio, nuevoModo: Servicio['modoFila']) {
  if (nuevoModo === 'COMPARTIDA') {
    const profesionales = await prisma.profesional.count({ where: { servicioId: servicio.id } })
    if (profesionales > 0) {
      errorDeNegocio(
        `${servicio.nombre} tiene ${profesionales} profesional(es) asignado(s), y un servicio de ventanilla no lleva profesionales. Muevelos a otro servicio antes de cambiar el modo de fila.`,
      )
    }

    const citas = await prisma.cita.count({
      where: { servicioId: servicio.id, estado: { not: 'CANCELADA' } },
    })
    if (citas > 0) {
      errorDeNegocio(
        `${servicio.nombre} tiene ${citas} cita(s) agendada(s) que quedarian sin doctor. Atiendelas o cancelalas antes de pasarlo a ventanilla.`,
      )
    }
    return
  }

  const enFila = await prisma.turno.count({
    where: {
      servicioId: servicio.id,
      profesionalId: null,
      estado: { in: ['EN_ESPERA', 'LLAMADO', 'EN_ATENCION'] },
    },
  })
  if (enFila > 0) {
    errorDeNegocio(
      `${servicio.nombre} tiene ${enFila} paciente(s) en la fila sin doctor asignado. Atiendelos antes de pasarlo a atencion por cita, o se quedarian en la cola sin que nadie pueda llamarlos.`,
    )
  }
}

export const turnoRepository: PrismaTurnoRepository = new PrismaTurnoRepository()

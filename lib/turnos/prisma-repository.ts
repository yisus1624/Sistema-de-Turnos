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
import { contextoDeTransaccion, prisma } from '@/lib/prisma'
import { cifrarSiSePuede, descifrar } from '@/lib/seguridad/cifrado'
import { realtimeHub } from '@/lib/realtime/hub'
import { ConflictoDeTurno, ErrorPasajero, errorDeNegocio } from './errores'
import { DEVUELTO_A_LA_FILA, exigirPlanVisto, planDeRetroceso, REABIERTO, type PlanDeRetroceso } from './reglas-retroceso'
import { decidirCierre, decidirRepeticion, ESTADOS_ABIERTOS, type EstadoDeCierre } from './reglas-cierre'
import {
  alcanceDelLlamado,
  candadoDelAlcance,
  exigirTurnoAbiertoEsperado,
  exigirVentanillaCompatible,
  moduloOcupado,
  perteneceAlAlcance,
  type SolicitudDeLlamado,
} from './reglas-llamado'
import { ordenAtencion, resumir, type PuestoEnLaFila } from './estadisticas'
import { reunirActividad } from './actividad'
import { modulosVisiblesEnPantalla, puestoDe } from './casillas'
import { motivoQueImpideCancelar, motivoQueImpideReprogramar } from './cita-transiciones'
import { motivoQueImpideDesactivarModulo } from './reglas-catalogo'
import { esConflictoPasajero, mensajeDeChoque } from './choques-unicos'
import { mismoDocumento, normalizarDocumento } from './documento'
import { CONFIGURACION_INICIAL } from './configuracion-inicial'
import { esDisenoPantalla } from './types'
import { CONFIGURACION_YA_CAMBIADA, exigirConfiguracionAlDia } from './configuracion-version'
import {
  ETIQUETA_JORNADA,
  ahoraISO,
  aMinutos,
  atiendeEnJornada,
  bloqueDeCita,
  bloquesConPacientes,
  jornadaSegunHoras,
  jornadasSegunCitas,
  diaColombia,
  esFechaValida,
  franjasDeJornada,
  horaColombia,
} from './tiempo'
import type { TurnoRepository } from './repository'
import type {
  AccionSobreTurno,
  ActividadCatalogo,
  AccesoProfesional,
  BloqueHorario,
  CasillaPantalla,
  Cita,
  CitaEnHorario,
  ColumnaHorario,
  ComprobanteLlegada,
  ConfiguracionGuardada,
  ConfiguracionSistema,
  EstadisticasDia,
  EstadoPantalla,
  EstadoAgendaItem,
  EstadoCita,
  FiltroHistorico,
  FiltroTurnoAbierto,
  HorarioDia,
  PeticionDeLlamado,
  ItemAgendaProfesional,
  JornadaDelDia,
  Jornada,
  LlegadaRegistrada,
  Modulo,
  Profesional,
  Servicio,
  Turno,
} from './types'

import { MINUTOS_ACCESO_MAXIMO, MINUTOS_ACCESO_MINIMO, MS_ENTRE_APUNTES_DE_USO } from './repository'

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

/** La fila de configuracion tal como la devuelve Prisma. */
type FilaConfiguracion = {
  actualizadoEn: Date
  audioActivo: boolean
  volumen: number
  mensajePie: string
  duracionCitaMinutos: number
  jornadaMananaInicio: string
  jornadaMananaFin: string
  jornadaTardeInicio: string
  jornadaTardeFin: string
  disenoPantalla: string
  fondoPantalla: string
}

function aConfiguracion(fila: FilaConfiguracion): ConfiguracionGuardada {
  return {
    actualizadoEn: fila.actualizadoEn.toISOString(),
    audioActivo: fila.audioActivo,
    volumen: fila.volumen,
    mensajePie: fila.mensajePie,
    // La columna es texto libre (ver el comentario del schema), asi que al
    // SALIR de la base se valida: una fila con un diseño que ya no existe
    // —quedo de una version anterior, o alguien la toco a mano— no puede
    // dejar el televisor en blanco. Ante la duda, el de siempre.
    disenoPantalla: esDisenoPantalla(fila.disenoPantalla)
      ? fila.disenoPantalla
      : CONFIGURACION_INICIAL.disenoPantalla,
    fondoPantalla: fila.fondoPantalla,
    duracionCitaMinutos: fila.duracionCitaMinutos,
    jornadaMananaInicio: fila.jornadaMananaInicio,
    jornadaMananaFin: fila.jornadaMananaFin,
    jornadaTardeInicio: fila.jornadaTardeInicio,
    jornadaTardeFin: fila.jornadaTardeFin,
  }
}

/**
 * La configuracion, creandola con los valores del hospital la primera vez.
 *
 * SE LEE, Y SOLO SE ESCRIBE EL DIA QUE NO EXISTE. Antes se resolvia con un
 * `upsert` a secas, asi que cada LECTURA era una ESCRITURA; y esta es la
 * consulta mas repetida del sistema, porque cuelga de la ruta de la pantalla
 * publica, que cada televisor encendido resincroniza sola cada minuto. Eran dos
 * escrituras por refresco contra una fila que no cambia en semanas.
 *
 * La creacion si va por `upsert`, que es lo que resuelve la carrera de dos
 * peticiones estrenando el sistema a la vez: la segunda no puede fallar con un
 * error de clave repetida que el funcionario no sabria interpretar.
 */
async function cargarConfiguracion(ctx: Ctx = prisma): Promise<ConfiguracionGuardada> {
  const fila = await ctx.configuracion.findUnique({ where: { id: ID_CONFIGURACION } })
  if (fila) return aConfiguracion(fila)

  const creada = await ctx.configuracion.upsert({
    where: { id: ID_CONFIGURACION },
    update: {},
    create: { id: ID_CONFIGURACION, ...CONFIGURACION_INICIAL },
  })

  return aConfiguracion(creada)
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

async function exigirCita(id: string, ctx: Ctx = prisma) {
  const cita = await ctx.cita.findUnique({ where: { id } })
  if (!cita) errorDeNegocio('La cita indicada no existe.')
  return cita
}

/**
 * La escritura condicionada no afecto a ninguna fila: alguien cambio la cita
 * mientras el operador la tenia abierta. Se vuelve a leer para contarle QUE
 * paso, en vez de un "no se pudo" que no le sirve de nada.
 */
async function rechazarPorCambioDeEstado(
  citaId: string,
  motivoQueLoImpide: (estado: EstadoCita) => string | null,
): Promise<never> {
  const cita = await exigirCita(citaId)
  errorDeNegocio(
    motivoQueLoImpide(cita.estado) ??
      'Otra persona acaba de cambiar esta cita. Vuelve a abrirla para ver como quedo.',
  )
}

/**
 * Deja escribir la cita y, si el indice del cupo manual la rechaza, lo cuenta
 * con las mismas palabras que la validacion previa.
 *
 * POR QUE UN INDICE Y NO UNA TRANSACCION. Meter "comprobar y crear" en una
 * transaccion NO cierra la carrera: con el nivel de aislamiento por defecto de
 * PostgreSQL (READ COMMITTED) las dos transacciones simultaneas leen la
 * parrilla sin la cita de la otra, y las dos insertan. Haria falta SERIALIZABLE
 * o bloquear la agenda del doctor, y eso frenaria la carga diaria del reporte
 * entera. El indice unico PARCIAL sobre (fecha, profesional, hora) de las citas
 * MANUALES no bloquea nada y es la unica garantia de verdad.
 *
 * Es PARCIAL a proposito: el hospital SI cita a dos pacientes con el mismo
 * doctor a la misma hora en su reporte, y la parrilla los apila queriendo. Lo
 * que no puede pasar es que un operador entregue a mano un cupo que ya esta
 * dado. Las citas importadas siguen defendidas solo por la validacion previa,
 * que basta: el reporte lo carga una persona a la vez.
 */
async function conCupoRespaldado<T>(
  nombreProfesional: string,
  horaCita: string,
  escribir: () => Promise<T>,
): Promise<T> {
  return conUnicidadRespaldada(
    {
      [INDICE_CUPO_MANUAL]: cupoOcupado(nombreProfesional, horaCita),
      // El unico (dia, documento, doctor, hora) incluye las canceladas: volver
      // a dar ese cupo al mismo paciente respondia 500.
      citaDelDia: `Este paciente ya tiene registrada una cita con ${nombreProfesional} a las ${horaColombia(horaCita)} de ese dia (aunque este cancelada, se conserva en el historial). Elige otra hora.`,
    },
    escribir,
  )
}

const cupoOcupado = (nombreProfesional: string, horaCita: string) =>
  `${nombreProfesional} ya tiene un paciente a las ${horaColombia(horaCita)}. Elige otra hora.`

/** Nombre del indice unico parcial de la migracion; Prisma lo informa tal cual. */
const INDICE_CUPO_MANUAL = 'citas_cupo_manual_unico'

/**
 * Escribe y, si la base rechaza por repetido, lo cuenta con el mismo aviso que
 * daria la validacion previa.
 *
 * Es el cierre de todas las reglas de unicidad de este archivo: la validacion
 * previa existe para avisar ANTES y con claridad, pero entre ella y la
 * escritura cabe otro operador. El indice es el que de verdad garantiza la
 * regla; esto solo evita que, cuando salte, el funcionario vea un error
 * tecnico.
 */
async function conUnicidadRespaldada<T>(
  mensajes: Record<string, string>,
  escribir: () => Promise<T>,
): Promise<T> {
  try {
    return await escribir()
  } catch (error) {
    const mensaje = mensajeDeChoque(error, mensajes)
    if (mensaje) errorDeNegocio(mensaje)
    throw error
  }
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

  // Las citas que el doctor YA tiene ese dia. Responden dos preguntas de una
  // sola consulta: que jornada trabaja ese dia y si la hora esta ocupada.
  const citasDelDia = await ctx.cita.findMany({
    where: { profesionalId: profesional.id, estado: { not: 'CANCELADA' }, fecha: diaDeLaCita },
    select: { id: true, horaCita: true },
  })

  // QUE JORNADA MANDA ESE DIA. La ficha dice lo habitual; las citas de ese dia
  // SUMAN. Es la misma regla con la que la parrilla decide las columnas, y
  // tiene que ser la misma: si el formulario aceptara algo que la parrilla no
  // pinta (o al reves), el operador agendaria un paciente que luego no ve.
  //
  // SUMAN, NUNCA RESTAN. Al doctor de mañana que hoy tiene pacientes por la
  // tarde se le puede agendar por la tarde, que es lo que el hospital hace
  // cuando alguien cambia de horario. Pero al de dia completo cuyo dia
  // arranca con una sola cita de las nueve NO se le cierra la tarde: ahi no
  // hay nada deducido todavia, solo un dia a medio llenar.
  const conPacientes = bloquesConPacientes(
    citasDelDia.map((c) => horaColombia(c.horaCita)),
    configuracion,
  )

  if (!atiendeEnJornada(profesional, bloque) && !conPacientes.has(bloque)) {
    errorDeNegocio(
      `${profesional.nombre} atiende en ${ETIQUETA_JORNADA[profesional.jornada]} y el ${diaDeLaCita} no tiene pacientes en la otra, asi que no se le puede agendar a las ${hora}.`,
    )
  }

  const instante = new Date(horaCita).getTime()
  const ocupada = citasDelDia.some((c) => c.id !== ignorarCitaId && c.horaCita.getTime() === instante)
  if (ocupada) {
    errorDeNegocio(`${profesional.nombre} ya tiene un paciente a las ${hora}. Elige otra hora.`)
  }
}

/** Los estados abiertos, en el formato que pide un `where` de Prisma. */
const ABIERTOS = { in: [...ESTADOS_ABIERTOS] }

/**
 * Desde que modulo puede llamar quien llama.
 *
 * Sin esto el `moduloId` viaja en el cuerpo de la peticion sin que nadie lo
 * contraste con quien la manda, y basta un id equivocado para llamar en la
 * puerta de otro. No es solo un numero mal puesto en la pantalla: al llamar se
 * da por ATENDIDO al paciente anterior, asi que se le cerraria la atencion a
 * otro sin enterarse ninguno de los dos.
 *
 *   1. El modulo tiene que estar activo.
 *   2. Un doctor, en cualquier consultorio (un salon puede tener doctores de
 *      varios servicios); CUAL es no lo elige la pantalla: la ruta del
 *      consultorio pasa el asignado al doctor (`consultorioDelProfesional`).
 *      Una ventanilla, solo filas compartidas y un modulo compatible.
 *   3. No puede haber OTRA persona atendiendo ahi en este momento (409).
 */
async function validarModuloParaLlamar(modulo: FilaModulo, quien: SolicitudDeLlamado, ctx: Ctx) {
  if (!modulo.activo) {
    errorDeNegocio(`${modulo.nombre} esta desactivado; no se puede llamar desde ahi.`)
  }

  // UN CONSULTORIO PUEDE SER UN SALON CON VARIOS DOCTORES. Cualquiera puede
  // tener dentro a doctores de cualquier servicio atendiendo a la vez, cada uno
  // en su espacio: al doctor no se le pide consultorio libre ni de su servicio.
  // Cada uno sale en su propia fila del televisor (ver `puestoDe`). Las
  // VENTANILLAS si siguen siendo de una persona: dos operadores en la misma se
  // cerraban los pacientes.
  if (quien.profesionalId) {
    await exigirProfesional(quien.profesionalId, ctx)
    return
  }
  exigirVentanillaCompatible(aServicio(await exigirServicio(quien.servicioId ?? '', ctx)), modulo)

  const ocupante = await ocupanteAjeno(modulo.id, alcanceDelLlamado(quien), ctx)
  if (ocupante) throw moduloOcupado(modulo.nombre, ocupante.profesional?.nombre ?? null, ocupante.codigo)
}

/**
 * Un turno abierto HOY en ese modulo que no es de quien llama.
 *
 * Solo cuenta lo de hoy: al final de la jornada es normal que el ultimo turno
 * quede abierto, y sin acotarlo al dia ese turno colgado de ayer dejaria el
 * modulo bloqueado para siempre. El alcance se compara en memoria y no en el
 * `where`: un `NOT` sobre una columna nula no se cumple en SQL, y el turno de
 * una ventanilla (sin profesional) no contaria como ocupante.
 */
async function ocupanteAjeno(moduloId: string, alcance: FiltroTurnoAbierto, ctx: Ctx) {
  const abiertos = await ctx.turno.findMany({
    where: { moduloId, fecha: diaColombia(ahoraISO()), estado: ABIERTOS, horaLlamado: { not: null } },
    include: { profesional: { select: { nombre: true } } },
  })
  return abiertos.find((turno) => !perteneceAlAlcance(turno, alcance))
}

/**
 * Tiempos de las transacciones, puestos a proposito.
 *
 * Los de Prisma por defecto (2 s para conseguir conexion, 5 s de vida) no
 * alcanzan con una base remota: el llamado hace una docena de idas y vueltas,
 * y con la red lenta la transaccion se cortaba con un P2028 que llegaba al
 * funcionario como un 500. Con estos margenes cabe una base lenta; mas alla,
 * es mejor fallar y que el funcionario reintente que tener conexiones
 * retenidas.
 */
const OPCIONES_TRANSACCION = { maxWait: 5_000, timeout: 15_000 }

/**
 * Una transaccion interactiva con los tiempos de arriba, que traduce los
 * choques pasajeros (P2028, P2034, deadlock) a un 503 "vuelve a intentarlo".
 */
async function enTransaccion<T>(trabajo: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    // Marcada para que el cliente no reintente nada dentro (ver `contextoDeTransaccion`).
    return await contextoDeTransaccion.run(true, () => prisma.$transaction(trabajo, OPCIONES_TRANSACCION))
  } catch (error) {
    if (esConflictoPasajero(error)) throw new ErrorPasajero()
    throw error
  }
}

/**
 * Candado de PostgreSQL que dura lo que dura la transaccion
 * (`pg_advisory_xact_lock`). No toca ninguna tabla ni hace falta migrar nada:
 * dos transacciones con la misma clave se esperan una a la otra.
 */
async function candadoDeTransaccion(clave: string, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${clave}))`
}

/**
 * Serializa los llamados de un mismo modulo hasta el final de la transaccion.
 *
 * Dos clics casi juntos (el doble clic, o el reintento que llega mientras la
 * primera peticion sigue viva) leerian el mismo "turno abierto", pasarian los
 * dos la comprobacion y se llevarian a dos pacientes. Con la fila del modulo
 * bloqueada, el segundo espera al primero y ya ve su llamado: recibe el 409.
 */
async function bloquearModulo(moduloId: string, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT "id" FROM "modulos" WHERE "id" = ${moduloId} FOR UPDATE`
}

/**
 * Siguiente codigo del servicio, EMPEZANDO DE NUEVO CADA DIA.
 *
 * El numero sale de contar los turnos que ese prefijo ya lleva hoy, en vez de
 * un contador guardado: asi no hay dos sitios que puedan discrepar, y el
 * reinicio diario es automatico. En una sala de espera el turno tiene que ser
 * un numero corto y del dia.
 *
 * LA CARRERA SE CORTA CON UN CANDADO, NO CON REINTENTOS. Antes, si dos
 * llegadas simultaneas sacaban el mismo numero, el indice unico rechazaba una
 * y se volvia a contar dentro de la misma transaccion. En PostgreSQL eso no
 * funciona: el error aborta la transaccion entera y todo lo que sigue falla,
 * asi que la segunda llegada terminaba en un 500. Ahora cada (dia, prefijo)
 * toma un candado de transaccion (`pg_advisory_xact_lock`) antes de contar: la
 * segunda espera a que la primera confirme, y al contar ya ve su turno. El
 * candado se suelta solo al terminar la transaccion y no toca ninguna tabla.
 */
async function siguienteCodigo(prefijo: string, fecha: string, tx: Prisma.TransactionClient) {
  await candadoDeTransaccion(`turnos:${fecha}:${prefijo}`, tx)
  const usados = await tx.turno.count({ where: { fecha, codigo: { startsWith: `${prefijo}-` } } })
  return `${prefijo}-${String(usados + 1).padStart(3, '0')}`
}

/** Crea el turno con su codigo del dia. Tiene que correr dentro de una transaccion. */
async function crearTurno(
  datos: Omit<Prisma.TurnoUncheckedCreateInput, 'codigo'>,
  prefijo: string,
  tx: Prisma.TransactionClient,
): Promise<FilaTurno> {
  const codigo = await siguienteCodigo(prefijo, datos.fecha, tx)
  return tx.turno.create({ data: { ...datos, codigo } })
}

/** Los datos de un cierre. `horaAtencion` solo la lleva el atendido. */
function datosDeCierre(nuevo: EstadoDeCierre, cerradoPor: string | null, automatico: boolean) {
  const instante = new Date()
  return {
    estado: nuevo,
    cerradoEn: instante,
    cerradoPor,
    cierreAutomatico: automatico,
    ...(nuevo === 'ATENDIDO' ? { horaAtencion: instante } : {}),
  }
}

/**
 * Cierra como ATENDIDO automatico el turno que quien llama tenia abierto, en la
 * misma transaccion que el llamado. Devuelve su modulo si lo cerro, o null.
 *
 * Cuando se pulsa "siguiente" se esta diciendo, implicitamente, que se termino
 * con el anterior (seccion 22, pasos 9 y 10). Queda marcado como cierre
 * AUTOMATICO: un paciente que se fue no puede verse en el historico igual que
 * una atencion que el doctor dio por terminada.
 *
 * SOLO EL TURNO VALIDADO, Y BLOQUEADO ANTES DE TOCARLO. Antes se leian los
 * abiertos, se actualizaban con una condicion y despues se marcaban como
 * atendidas las citas de la lista LEIDA, no de lo que de verdad cambio. Si en
 * medio otro equipo marcaba ese paciente como AUSENTE, el update no cambiaba
 * nada pero la cita quedaba ATENDIDA igual. Con `FOR UPDATE` se espera a esa
 * otra transaccion y, si el turno ya no esta abierto, no se toca ni el turno ni
 * su cita.
 */
async function cerrarAutomaticamente(turnoId: string, tx: Prisma.TransactionClient): Promise<string | null> {
  const bloqueados = await tx.$queryRaw<Array<{ citaId: string | null; moduloId: string | null }>>`
    SELECT "citaId", "moduloId" FROM "turnos"
    WHERE "id" = ${turnoId} AND "estado" IN ('LLAMADO', 'EN_ATENCION')
    FOR UPDATE`
  const fila = bloqueados[0]
  if (!fila) return null

  await tx.turno.update({ where: { id: turnoId }, data: datosDeCierre('ATENDIDO', null, true) })
  await marcarCitasAtendidas([fila.citaId], tx)
  return fila.moduloId
}

async function marcarCitasAtendidas(citaIds: Array<string | null>, tx: Prisma.TransactionClient) {
  const citas = citaIds.filter((id): id is string => Boolean(id))
  if (citas.length > 0) await tx.cita.updateMany({ where: { id: { in: citas } }, data: { estado: 'ATENDIDA' } })
}

/**
 * Reclama el primero de la fila que siga en espera.
 *
 * RECLAMAR, no "leer y escribir": el update solo prospera si el turno SIGUE en
 * espera. Si otro modulo se lo llevo entre la consulta y el update, afecta cero
 * filas y se pasa al siguiente de la cola.
 */
async function reclamarSiguiente(
  fila: { servicioId?: string; profesionalId?: string },
  llamado: { moduloId: string; funcionarioId: string },
  tx: Prisma.TransactionClient,
): Promise<string | null> {
  for (const candidato of await pendientesDeHoy(fila, tx)) {
    const instante = new Date()
    const reclamado = await tx.turno.updateMany({
      where: { id: candidato.id, estado: 'EN_ESPERA' },
      data: { ...llamado, estado: 'LLAMADO', horaLlamado: instante, vecesLlamado: { increment: 1 } },
    })
    if (reclamado.count === 0) continue

    // El PRIMER llamado se graba una sola vez: es contra el que se mide la
    // espera del paciente. Va aparte porque `updateMany` no sabe hacer "solo si
    // esta vacio".
    await tx.turno.updateMany({ where: { id: candidato.id, horaPrimerLlamado: null }, data: { horaPrimerLlamado: instante } })
    return candidato.id
  }
  return null
}

/** Turnos en espera de hoy, en el orden en que hay que atenderlos. */
async function pendientesDeHoy(filtro: { servicioId?: string; profesionalId?: string }, ctx: Ctx): Promise<Turno[]> {
  const filas = await ctx.turno.findMany({
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
 * Avisa a las pantallas DESPUES de confirmar el cambio, y sin tumbarlo.
 *
 * Antes el aviso iba en medio del llamado: si fallaba armar la casilla, el
 * paciente quedaba LLAMADO en la base, sin campana en la sala y con el doctor
 * viendo un error; al repetir, ese paciente se cerraba en silencio. El cambio
 * ya esta hecho y es lo que importa: si el aviso falla, se grita en el
 * registro del servidor y las pantallas se ponen al dia con su propia
 * resincronizacion.
 */
async function avisarSinTumbar(avisar: () => Promise<void> | void) {
  try {
    await avisar()
  } catch (error) {
    console.error('[turnos] el cambio quedo guardado, pero no se pudo avisar a las pantallas', error)
  }
}

function avisarLlamado(turno: FilaTurno, repetido: boolean) {
  return avisarSinTumbar(async () => {
    realtimeHub.publish({ tipo: 'turno.llamado', casilla: await casillaDeTurno(turno), repetido })
  })
}

function avisarModuloLiberado(moduloId: string | null, profesionalId?: string | null) {
  if (!moduloId) return Promise.resolve()
  return avisarSinTumbar(() =>
    realtimeHub.publish({ tipo: 'modulo.liberado', moduloId, puesto: puestoDe(moduloId, profesionalId) }),
  )
}

/**
 * Cierra un turno a mano, condicionado al estado e idempotente.
 *
 * La pregunta de `decidirCierre` se hace antes de escribir y otra vez si el
 * update condicionado no afecto a ninguna fila: eso es que otro camino (el
 * cierre automatico de un llamado, otra pestaña) lo cerro en medio. Sin la
 * condicion, un "ausente" que coincidia con el cierre automatico dejaba el
 * turno AUSENTE con la cita ATENDIDA.
 */
async function cerrarTurno(turnoId: string, nuevo: EstadoDeCierre, cerradoPor?: string): Promise<AccionSobreTurno> {
  const resultado = await enTransaccion(async (tx) => {
    const antes = await exigirTurno(turnoId, tx)
    if (decidirCierre(aTurno(antes), nuevo) === 'ya_aplicada') return { turno: antes, yaAplicada: true }

    const hecho = await tx.turno.updateMany({
      where: { id: turnoId, estado: ABIERTOS },
      data: datosDeCierre(nuevo, cerradoPor ?? null, false),
    })
    if (hecho.count === 0) return { turno: await releerYDecidir(turnoId, nuevo, tx), yaAplicada: true }
    if (nuevo === 'ATENDIDO') await marcarCitasAtendidas([antes.citaId], tx)
    return { turno: await tx.turno.findUniqueOrThrow({ where: { id: turnoId } }), yaAplicada: false }
  })

  if (!resultado.yaAplicada) await avisarModuloLiberado(resultado.turno.moduloId, resultado.turno.profesionalId)
  return { turno: aTurno(resultado.turno), yaAplicada: resultado.yaAplicada }
}

/**
 * El plan de retroceso de un doctor, leido con `ctx` (dentro o fuera de la
 * transaccion). Solo pacientes de HOY: ayer ya no se deshace.
 */
async function leerPlanDeRetroceso(profesionalId: string, ctx: Ctx): Promise<PlanDeRetroceso | null> {
  return (await leerFilasDeRetroceso(profesionalId, ctx)).plan
}

/** Las filas tal como estan en la base, ademas del plan: el aviso al televisor se arma con ellas. */
async function leerFilasDeRetroceso(profesionalId: string, ctx: Ctx) {
  const fecha = diaColombia(ahoraISO())
  const [abierto, ultimoCerrado] = await Promise.all([
    ctx.turno.findFirst({ where: { profesionalId, fecha, estado: ABIERTOS }, orderBy: { horaLlamado: 'desc' } }),
    ctx.turno.findFirst({
      where: { profesionalId, fecha, estado: { in: ['ATENDIDO', 'AUSENTE'] }, cerradoEn: { not: null } },
      orderBy: { cerradoEn: 'desc' },
    }),
  ])
  const plan = planDeRetroceso(abierto ? aTurno(abierto) : null, ultimoCerrado ? aTurno(ultimoCerrado) : null)
  const filaDe = (turno: Turno | null | undefined) =>
    turno ? ([abierto, ultimoCerrado].find((fila) => fila?.id === turno.id) ?? null) : null
  return { plan, filas: { devolver: filaDe(plan?.devolver), restaurar: filaDe(plan?.restaurar) } }
}

/**
 * Aplica el plan dentro de la transaccion. Cada cambio va CONDICIONADO al
 * estado que se leyo: si otro camino lo cambio en medio (admisiones cerro al
 * paciente, otro equipo del doctor), no se toca nada y es un 409.
 */
async function aplicarRetroceso(
  plan: PlanDeRetroceso,
  filas: { devolver: FilaTurno | null; restaurar: FilaTurno | null },
  tx: Prisma.TransactionClient,
) {
  if (plan.devolver) {
    const hecho = await tx.turno.updateMany({
      where: { id: plan.devolver.id, estado: ABIERTOS },
      data: DEVUELTO_A_LA_FILA,
    })
    if (hecho.count === 0) throw new ConflictoDeTurno('El paciente en atencion cambio mientras retrocedias. Revisa tu pantalla.')
  }
  if (plan.restaurar) {
    const hecho = await tx.turno.updateMany({
      where: { id: plan.restaurar.id, estado: plan.restaurar.estado },
      data: REABIERTO,
    })
    if (hecho.count === 0) throw new ConflictoDeTurno('El paciente anterior cambio mientras retrocedias. Revisa tu pantalla.')
    // Su cita vuelve a "llego y esta en consulta": el cierre ya no vale.
    if (plan.restaurar.citaId) {
      await tx.cita.updateMany({ where: { id: plan.restaurar.citaId, estado: 'ATENDIDA' }, data: { estado: 'PRESENTADO' } })
    }
  }
  // Como quedaron, sin volver a leerlas: los cambios condicionados ya
  // confirmaron que partian de esas filas. Una lectura menos por cada una, y el
  // aviso al televisor sale antes.
  return {
    devuelto: filas.devolver ? { ...filas.devolver, ...DEVUELTO_A_LA_FILA } : null,
    restaurado: filas.restaurar ? { ...filas.restaurar, ...REABIERTO } : null,
  }
}

/**
 * Avisa del retroceso: el puesto del paciente anterior vuelve a mostrarlo, y el
 * del que regreso a la fila (`moduloDevuelto`, el que tenia ANTES: al volver a
 * la fila se le borra) queda libre si era otro. La fila del doctor cambio
 * (tiene un paciente mas en espera).
 */
async function avisarRetroceso(moduloDevuelto: string | null, devuelto: FilaTurno | null, restaurado: FilaTurno | null) {
  await avisarSinTumbar(async () => {
    const puestoRestaurado = restaurado?.moduloId ? puestoDe(restaurado.moduloId, restaurado.profesionalId) : null
    if (restaurado?.moduloId && puestoRestaurado) {
      realtimeHub.publish({
        tipo: 'turno.devuelto',
        moduloId: restaurado.moduloId,
        puesto: puestoRestaurado,
        casilla: await casillaDeTurno(restaurado),
      })
    }
    if (devuelto && moduloDevuelto) {
      const puesto = puestoDe(moduloDevuelto, devuelto.profesionalId)
      if (puesto !== puestoRestaurado) {
        realtimeHub.publish({ tipo: 'turno.devuelto', moduloId: moduloDevuelto, puesto, casilla: null })
      }
    }
    if (devuelto) {
      realtimeHub.publish({ tipo: 'fila.cambiada', servicioId: devuelto.servicioId, profesionalId: devuelto.profesionalId })
    }
  })
}

/**
 * Suma una repeticion solo si el turno sigue abierto y, si la pantalla dijo que
 * conteo veia, solo si sigue siendo ese: dos reintentos simultaneos del mismo
 * clic suman una sola. Devuelve cuantas filas cambio (0 o 1).
 */
async function repetirCondicionado(turno: FilaTurno, vecesLlamadoVisto?: number): Promise<number> {
  const instante = new Date()
  const hecho = await prisma.turno.updateMany({
    where: {
      id: turno.id,
      estado: ABIERTOS,
      ...(vecesLlamadoVisto === undefined ? {} : { vecesLlamado: vecesLlamadoVisto }),
    },
    // Se actualiza el ULTIMO llamado (la pantalla ordena por el), nunca el
    // primero: repetir no puede reescribir cuanto espero el paciente.
    data: { vecesLlamado: { increment: 1 }, horaLlamado: instante, horaPrimerLlamado: turno.horaPrimerLlamado ?? instante },
  })
  return hecho.count
}

/** Otro camino cerro el turno en medio: o ya esta como se pedia, o es un 409. */
async function releerYDecidir(turnoId: string, nuevo: EstadoDeCierre, tx: Prisma.TransactionClient) {
  const ahora = await exigirTurno(turnoId, tx)
  decidirCierre(aTurno(ahora), nuevo)
  return ahora
}

/** El turno que genero la cita (el ultimo, si hubiera mas de uno). */
async function turnoDeLaCita(citaId: string, ctx: Ctx = prisma) {
  return ctx.turno.findFirst({ where: { citaId }, orderBy: { fechaGeneracion: 'desc' } })
}

/** Otra peticion registro la llegada en medio: se devuelve su turno. */
async function llegadaYaRegistrada(citaId: string, tx: Prisma.TransactionClient): Promise<LlegadaRegistrada> {
  const turno = await turnoDeLaCita(citaId, tx)
  if (!turno) errorDeNegocio('Esta cita ya registro la llegada del paciente.')
  return { turno: aTurno(turno), yaRegistrada: true }
}

/**
 * Las ultimas defensas antes de generar el turno.
 *
 * El dia: aunque la busqueda solo ofrezca las citas de hoy, el id llega en el
 * cuerpo de la peticion, y una llegada contra una cita de otro dia mete al
 * paciente en la fila equivocada.
 *
 * El doctor activo: si lo dieron de baja, su enlace ya no sirve y nadie
 * llamaria a este paciente. Mejor que admisiones se entere ahora, con el
 * paciente delante, y le resuelva la cita.
 */
async function validarCitaParaLlegada(cita: FilaCita) {
  const hoy = diaColombia(ahoraISO())
  if (cita.fecha !== hoy) {
    errorDeNegocio(
      `Esta cita no es de hoy, es del ${cita.fecha}. Solo se puede registrar la llegada el mismo dia de la cita.`,
    )
  }

  const profesional = await prisma.profesional.findUnique({ where: { id: cita.profesionalId } })
  if (!profesional?.activo) {
    errorDeNegocio(
      'El profesional de esta cita ya no esta activo, asi que no podria llamar al paciente. Reasignale la cita a otro profesional.',
    )
  }
}

/** Lo que deja un llamado: el turno llamado y, si lo hubo, el modulo que quedo libre. */
interface Llamado {
  turno: FilaTurno
  moduloLiberado: string | null
}

/**
 * El cuerpo de `llamarSiguiente` dentro de la transaccion, con el modulo y el
 * alcance ya bloqueados y validados. Devuelve null si no hay nadie en espera.
 */
async function llamarDentroDeTransaccion(params: PeticionDeLlamado, tx: Prisma.TransactionClient): Promise<Llamado | null> {
  const alcance = alcanceDelLlamado(params)
  const abierto = await tx.turno.findFirst({
    where: { ...alcance, fecha: diaColombia(ahoraISO()), estado: ABIERTOS },
    orderBy: { horaLlamado: 'desc' },
  })
  exigirTurnoAbiertoEsperado(abierto ? aTurno(abierto) : null, params.turnoAbiertoEsperado)

  const fila = { servicioId: params.servicioId, profesionalId: params.profesionalId }
  const reclamado = await reclamarSiguiente(fila, { moduloId: params.moduloId, funcionarioId: params.funcionarioId }, tx)
  if (!reclamado) return null

  // Quien llama atiende a un paciente a la vez: SU anterior —el que acaba de
  // validarse contra lo que ve la pantalla— se da por atendido.
  const moduloDelAnterior = abierto ? await cerrarAutomaticamente(abierto.id, tx) : null
  return {
    turno: await tx.turno.findUniqueOrThrow({ where: { id: reclamado } }),
    moduloLiberado: moduloDelAnterior && moduloDelAnterior !== params.moduloId ? moduloDelAnterior : null,
  }
}

/**
 * Los candados del llamado, siempre en el mismo orden (modulo, luego alcance)
 * para que dos llamados no se esperen el uno al otro para siempre.
 */
async function bloquearParaLlamar(params: PeticionDeLlamado, tx: Prisma.TransactionClient): Promise<FilaModulo> {
  await bloquearModulo(params.moduloId, tx)
  const candado = candadoDelAlcance(alcanceDelLlamado(params))
  if (candado) await candadoDeTransaccion(candado, tx)
  // El modulo se lee DESPUES del candado: si lo desactivaron mientras tanto,
  // se ve.
  return exigirModulo(params.moduloId, tx)
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

/** Dias enteros de `desde` a `hasta`, los dos AAAA-MM-DD. */
/**
 * Ids de las citas de ese documento, comparando los DOS lados normalizados.
 *
 * Las citas hechas a mano antes de normalizar se guardaron tal cual se
 * tecleo ("1.067.890.123") y no se reescriben: se encuentran igual porque la
 * comparacion normaliza tambien lo guardado. Solo viajan id y documento de las
 * citas que ya pasan los demas filtros (las de un dia, o las por venir).
 */
async function idsDelDocumento(documento: string, where: Prisma.CitaWhereInput): Promise<string[]> {
  const candidatas = await prisma.cita.findMany({ where, select: { id: true, documentoPaciente: true } })
  return candidatas.filter((cita) => mismoDocumento(cita.documentoPaciente, documento)).map((cita) => cita.id)
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

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

    const documento = normalizarDocumento(datos.documentoPaciente)
    const nombre = datos.nombrePaciente.trim()
    if (!documento) errorDeNegocio('Ingresa el documento del paciente.')
    if (!nombre) errorDeNegocio('Ingresa el nombre del paciente.')
    if (Number.isNaN(new Date(datos.horaCita).getTime())) errorDeNegocio('La hora de la cita no es valida.')

    // Las mismas reglas que `reprogramarCita`, que es volver a agendar: si al
    // servicio se le cambio el modo de fila, aqui no se cuela una cita para un
    // servicio que atiende por orden de llegada.
    validarServicioDeProfesional(await exigirServicio(profesional.servicioId))
    await validarFranjaDeCita({ horaCita: datos.horaCita, profesional })

    const fila = await conCupoRespaldado(profesional.nombre, datos.horaCita, () =>
      prisma.cita.create({
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
      }),
    )
    return aCita(fila)
  }

  async cancelarCita(citaId: string, datos: { usuarioId?: string; motivo?: string } = {}): Promise<Cita> {
    const cita = await exigirCita(citaId)
    const impedimento = motivoQueImpideCancelar(cita.estado)
    if (impedimento) errorDeNegocio(impedimento)

    // LA ESCRITURA VA CONDICIONADA AL ESTADO, no a lo que se leyo arriba. El
    // operador puede tener el detalle de la cita abierto mientras admisiones
    // registra la llegada de ese mismo paciente: sin la condicion, la
    // cancelacion pisaria el PRESENTADO y dejaria al paciente sentado en la
    // sala con un turno en la fila del doctor y su cita cancelada.
    const cancelada = await prisma.cita.updateMany({
      where: { id: citaId, estado: 'PROGRAMADA' },
      data: {
        estado: 'CANCELADA',
        // Quien, cuando y por que: los datos con los que se le responde
        // despues al paciente que viene a reclamar.
        canceladaEn: new Date(),
        canceladaPor: datos.usuarioId ?? null,
        motivoCancelacion: datos.motivo?.trim() || null,
      },
    })
    if (cancelada.count === 0) await rechazarPorCambioDeEstado(citaId, motivoQueImpideCancelar)

    return aCita(await exigirCita(citaId))
  }

  async reprogramarCita(
    citaId: string,
    datos: { horaCita: string; profesionalId?: string; motivo?: string; usuarioId?: string },
  ): Promise<Cita> {
    const cita = await exigirCita(citaId)
    const impedimento = motivoQueImpideReprogramar(cita.estado)
    if (impedimento) errorDeNegocio(impedimento)

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

    // Igual que al cancelar: entre la comprobacion y esta escritura cabe la
    // llegada del paciente. Moverla de todas formas dejaria su turno de hoy
    // colgado de una hora que ya no existe, y en otro dia.
    const movida = await conCupoRespaldado(profesional.nombre, datos.horaCita, () =>
      prisma.cita.updateMany({
        where: { id: citaId, estado: 'PROGRAMADA' },
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
      }),
    )
    if (movida.count === 0) await rechazarPorCambioDeEstado(citaId, motivoQueImpideReprogramar)

    const fila = await exigirCita(citaId)
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
    const jornadaDelDoctor = new Map<string, Jornada | null>(
      jornadasSegunCitas(
        citasDelDia.map((c) => ({ profesionalId: c.profesionalId, hora: horaColombia(c.horaCita) })),
        configuracion,
      ).map((j) => [j.profesionalId, j.jornada]),
    )

    // EN QUE BLOQUES TIENE PACIENTES HOY CADA DOCTOR.
    //
    // La jornada de su ficha dice a que horas se le PUEDE agendar, pero no
    // manda sobre las citas que ya existen. Cuando las dos cosas no coinciden
    // —el reporte le trajo pacientes por la tarde a alguien que esta guardado
    // como de mañana— el doctor se quedaba sin columna en la tarde y sus
    // pacientes caian en "citas sin doctor en la parrilla" aunque el doctor
    // estuviera activo y atendiendo. Pasaba con quien cambia de horario y con
    // quien entro al catalogo antes de que la jornada se dedujera.
    //
    // Se le abre columna en el bloque donde de verdad tiene citas. La ficha
    // sigue mandando en lo suyo: agendar a mano.
    const bloquesConCitas = new Map<string, Set<Jornada>>()
    for (const cita of citasDelDia) {
      const bloque = bloqueDeCita(
        horaColombia(cita.horaCita),
        configuracion,
        jornadaDelDoctor.get(cita.profesionalId) ?? null,
      )
      const suyos = bloquesConCitas.get(cita.profesionalId)
      if (suyos) suyos.add(bloque)
      else bloquesConCitas.set(cita.profesionalId, new Set([bloque]))
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
        .filter((p) => atiendeEnJornada(p, jornada) || bloquesConCitas.get(p.id)?.has(jornada) === true)
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

  /** Ver `jornadasDelDia` en el contrato del repositorio. */
  async jornadasDelDia(fecha: string): Promise<JornadaDelDia[]> {
    // Las canceladas no cuentan: un dia cuyas citas se cancelaron todas es un
    // dia que el doctor no trabaja, y contarlas diria lo contrario.
    const [configuracion, citas] = await Promise.all([
      cargarConfiguracion(),
      prisma.cita.findMany({
        where: { fecha, estado: { not: 'CANCELADA' } },
        select: { profesionalId: true, horaCita: true },
      }),
    ])

    return jornadasSegunCitas(
      citas.map((c) => ({ profesionalId: c.profesionalId, hora: horaColombia(c.horaCita) })),
      configuracion,
    )
  }

  /** Ver `actividadDelCatalogo` en el contrato del repositorio. */
  async actividadDelCatalogo(fecha: string): Promise<ActividadCatalogo> {
    // Las canceladas no cuentan, igual que en las jornadas: un servicio cuyas
    // citas se cancelaron todas es un servicio que ese dia no atendio.
    const [citas, profesionales] = await Promise.all([
      prisma.cita.findMany({
        where: { fecha, estado: { not: 'CANCELADA' } },
        select: { servicioId: true, profesionalId: true, horaCita: true },
      }),
      prisma.profesional.findMany({ select: { id: true, moduloId: true } }),
    ])

    // El consultorio no esta en la cita: esta en el doctor que la atiende.
    const moduloDelProfesional = new Map(profesionales.map((p) => [p.id, p.moduloId]))

    return reunirActividad(
      fecha,
      citas.map((cita) => ({
        servicioId: cita.servicioId,
        moduloId: moduloDelProfesional.get(cita.profesionalId) ?? null,
        hora: horaColombia(cita.horaCita),
      })),
    )
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

  async traerCitasDelUltimoDia(hoy: string, excluirProfesionales: string[] = []): Promise<{ desde: string | null; movidas: number }> {
    const ultima = await prisma.cita.findFirst({
      where: { fecha: { lt: hoy }, estado: { not: 'CANCELADA' }, profesionalId: { notIn: excluirProfesionales } },
      orderBy: { fecha: 'desc' },
      select: { fecha: true },
    })
    if (!ultima) return { desde: null, movidas: 0 }

    // Se corre la hora por dias enteros: la cita de las 7:00 de ayer queda a
    // las 7:00 de hoy, y `fecha` sigue diciendo el dia de Colombia.
    const dias = diasEntre(ultima.fecha, hoy)
    const movidas = await prisma.$executeRaw`
      UPDATE "citas"
      SET "fecha" = ${hoy},
          "horaCita" = "horaCita" + make_interval(days => ${dias}::int),
          "estado" = 'PROGRAMADA'
      WHERE "fecha" = ${ultima.fecha} AND "estado" <> 'CANCELADA'
        AND "profesionalId" <> ALL(${excluirProfesionales}::text[])`
    return { desde: ultima.fecha, movidas }
  }

  async eliminarConsultoriosDeSimulacion(prefijo: string): Promise<number> {
    const { count } = await prisma.modulo.deleteMany({ where: { nombre: { startsWith: prefijo } } })
    return count
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
    const buscado = normalizarDocumento(documento)
    if (!buscado) return []

    const ids = await idsDelDocumento(buscado, { estado: { not: 'CANCELADA' }, fecha: fecha ?? diaColombia(ahoraISO()) })
    if (ids.length === 0) return []

    const filas = await prisma.cita.findMany({
      where: { id: { in: ids } },
      orderBy: { horaCita: 'asc' },
      include: { turnos: { select: { codigo: true }, orderBy: { fechaGeneracion: 'desc' }, take: 1 } },
    })
    return filas.map((fila) => ({ ...aCita(fila), codigoTurno: fila.turnos[0]?.codigo ?? null }))
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
    const buscado = normalizarDocumento(documento)
    if (!buscado) return []

    const ids = await idsDelDocumento(buscado, { estado: 'PROGRAMADA', fecha: { gt: fecha ?? diaColombia(ahoraISO()) } })
    if (ids.length === 0) return []

    const filas = await prisma.cita.findMany({
      where: { id: { in: ids } },
      orderBy: { horaCita: 'asc' },
    })
    return filas.map(aCita)
  }

  async registrarLlegada(citaId: string): Promise<LlegadaRegistrada> {
    const cita = await exigirCita(citaId)
    if (cita.estado === 'CANCELADA') errorDeNegocio('La cita fue cancelada.')

    // El reintento de una llegada cuya respuesta se perdio: se devuelve el
    // turno que ya genero, para que admisiones pueda dictar el comprobante.
    const yaGenerado = cita.estado === 'PRESENTADO' ? await turnoDeLaCita(cita.id) : null
    if (yaGenerado) return { turno: aTurno(yaGenerado), yaRegistrada: true }
    if (cita.estado !== 'PROGRAMADA') errorDeNegocio('Esta cita ya registro la llegada del paciente.')

    await validarCitaParaLlegada(cita)
    return this.generarTurnoDeLaCita(cita)
  }

  /**
   * El paso a PRESENTADO y la creacion del turno, juntos o nada.
   *
   * El paso va condicionado al estado, no a "leerlo y luego escribirlo": si dos
   * ventanillas registran al mismo paciente a la vez, solo una avanza. La otra
   * espera a que la primera confirme, encuentra la cita ya PRESENTADO y
   * devuelve el mismo turno en vez de generarle un segundo.
   */
  private async generarTurnoDeLaCita(cita: FilaCita): Promise<LlegadaRegistrada> {
    const servicio = await exigirServicio(cita.servicioId)

    return enTransaccion(async (tx) => {
      const marcada = await tx.cita.updateMany({ where: { id: cita.id, estado: 'PROGRAMADA' }, data: { estado: 'PRESENTADO' } })
      if (marcada.count === 0) return llegadaYaRegistrada(cita.id, tx)

      const turno = await crearTurno(
        {
          servicioId: servicio.id,
          estado: 'EN_ESPERA',
          prioridad: 'NORMAL',
          fecha: cita.fecha,
          vecesLlamado: 0,
          citaId: cita.id,
          profesionalId: cita.profesionalId,
          nombrePaciente: cita.nombrePaciente,
          horaCita: cita.horaCita,
        },
        servicio.prefijo,
        tx,
      )
      return { turno: aTurno(turno), yaRegistrada: false }
    })
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
      estadoTurno: turno.estado,
    }
  }

  async generarTurnoDeVentanilla(servicioId: string): Promise<Turno> {
    const servicio = await exigirServicio(servicioId)
    if (servicio.modoFila !== 'COMPARTIDA') {
      errorDeNegocio('Este servicio atiende por cita: el turno se genera al registrar la llegada del paciente.')
    }

    // En transaccion: el candado del codigo (ver `siguienteCodigo`) dura lo
    // que dura ella.
    const turno = await enTransaccion((tx) =>
      crearTurno(
        { servicioId: servicio.id, estado: 'EN_ESPERA', prioridad: 'NORMAL', fecha: diaColombia(ahoraISO()), vecesLlamado: 0 },
        servicio.prefijo,
        tx,
      ),
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
    return pendientesDeHoy(filtro, prisma)
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

  async turnoEsDeLaVentanilla(turnoId: string, funcionarioId: string): Promise<boolean> {
    const turno = await prisma.turno.findFirst({
      where: { id: turnoId, funcionarioId, servicio: { modoFila: 'COMPARTIDA' } },
      select: { id: true },
    })
    return Boolean(turno)
  }

  /** El turno abierto que cumple el filtro, o null (ver el contrato). */
  async turnoAbierto(filtro: FiltroTurnoAbierto, fecha: string): Promise<Turno | null> {
    const fila = await prisma.turno.findFirst({
      where: { ...filtro, fecha, estado: ABIERTOS },
      orderBy: { horaLlamado: 'desc' },
    })
    return fila ? aTurno(fila) : null
  }

  /**
   * Llamar al siguiente, en una sola transaccion.
   *
   * Comprobar el turno abierto, reclamar al siguiente y cerrar el anterior van
   * juntos o no van: antes eran pasos sueltos, y un fallo a mitad dejaba al
   * paciente LLAMADO con el anterior todavia abierto. El aviso a la pantalla va
   * DESPUES de confirmar (ver `avisarSinTumbar`).
   */
  async llamarSiguiente(params: PeticionDeLlamado): Promise<Turno | null> {
    if (!params.servicioId && !params.profesionalId) {
      errorDeNegocio('Debes indicar el servicio o el profesional.')
    }

    const llamado = await enTransaccion(async (tx) => {
      await validarModuloParaLlamar(await bloquearParaLlamar(params, tx), params, tx)
      return llamarDentroDeTransaccion(params, tx)
    })
    if (!llamado) return null

    // Si el anterior estaba en otro consultorio (el doctor se cambio de
    // puerta), esa casilla del televisor queda libre.
    await avisarModuloLiberado(llamado.moduloLiberado, llamado.turno.profesionalId)
    await avisarLlamado(llamado.turno, false)
    return aTurno(llamado.turno)
  }

  async repetirLlamado(turnoId: string, opciones: { vecesLlamadoVisto?: number } = {}): Promise<AccionSobreTurno> {
    const turno = await exigirTurno(turnoId)
    if (!turno.moduloId) errorDeNegocio('El turno no ha sido llamado todavia.')
    if (decidirRepeticion(aTurno(turno), opciones.vecesLlamadoVisto) === 'ya_aplicada') {
      return { turno: aTurno(turno), yaAplicada: true }
    }

    const hecho = await repetirCondicionado(turno, opciones.vecesLlamadoVisto)
    const actualizado = await exigirTurno(turnoId)
    if (hecho === 0) {
      // Otro camino se adelanto: lo cerraron (409) o ya se repitio con este
      // mismo conteo (el reintento simultaneo), y entonces no se vuelve a sonar.
      decidirRepeticion(aTurno(actualizado), opciones.vecesLlamadoVisto)
      return { turno: aTurno(actualizado), yaAplicada: true }
    }

    await avisarLlamado(actualizado, true)
    return { turno: aTurno(actualizado), yaAplicada: false }
  }

  async marcarAtendido(turnoId: string, cerradoPor?: string): Promise<AccionSobreTurno> {
    return cerrarTurno(turnoId, 'ATENDIDO', cerradoPor)
  }

  async marcarAusente(turnoId: string, cerradoPor?: string): Promise<AccionSobreTurno> {
    return cerrarTurno(turnoId, 'AUSENTE', cerradoPor)
  }

  async planDeRetroceso(profesionalId: string): Promise<PlanDeRetroceso | null> {
    return leerPlanDeRetroceso(profesionalId, prisma)
  }

  /**
   * Retroceder, en una sola transaccion y con el MISMO candado que los llamados
   * de ese doctor: un "Siguiente" y un "Retroceder" casi juntos (dos equipos,
   * o un doble clic cruzado) se esperan el uno al otro en vez de mezclarse.
   */
  async retrocederTurno(
    profesionalId: string,
    visto: { turnoAbiertoId: string | null; restaurarId: string | null },
  ): Promise<PlanDeRetroceso> {
    const { plan, devuelto, restaurado } = await enTransaccion(async (tx) => {
      const candado = candadoDelAlcance({ profesionalId })
      if (candado) await candadoDeTransaccion(candado, tx)
      const leido = await leerFilasDeRetroceso(profesionalId, tx)
      const plan = exigirPlanVisto(leido.plan, visto)
      return { plan, ...(await aplicarRetroceso(plan, leido.filas, tx)) }
    })

    await avisarRetroceso(plan.devolver?.moduloId ?? null, devuelto, restaurado)
    return { devolver: devuelto ? aTurno(devuelto) : null, restaurar: restaurado ? aTurno(restaurado) : null }
  }

  // --- Pantalla de la sala de espera ---

  /**
   * Estado de la pantalla: una casilla por consultorio QUE TRABAJA HOY.
   *
   * SOLO turnos llamados HOY. Un turno queda en LLAMADO hasta que el doctor lo
   * cierra, y al final de la jornada es normal que el ultimo se quede sin
   * cerrar. Sin este filtro ese turno sigue pintado en el televisor a la
   * mañana siguiente, y el primer paciente del dia ve un numero que ya paso y
   * cree que le toca.
   *
   * NO BASTA CON QUE EL CONSULTORIO ESTE ACTIVO: quien decide que se ve es
   * `modulosVisiblesEnPantalla`, en `./casillas`, que es puro y lo comparten
   * las dos implementaciones del repositorio. Ahi esta explicado el criterio y
   * por que.
   */
  async estadoPantalla(): Promise<EstadoPantalla> {
    const hoy = diaColombia(ahoraISO())

    const [
      todosLosModulos,
      servicios,
      todosLosProfesionales,
      llamados,
      citasDeHoy,
      enEsperaDeHoy,
      turnosDeHoy,
      configuracion,
      citasRegistradasHoy,
    ] = await Promise.all([
      prisma.modulo.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
      prisma.servicio.findMany(),
      // TODOS, no solo los activos: el consultorio de una cita se resuelve por
      // el doctor que la atiende, y con la lista recortada las citas de un
      // doctor dado de baja no se contaban. Su consultorio desaparecia del
      // televisor con sus pacientes ya en la sala. Para ROTULAR la casilla si
      // se usan solo los activos, mas abajo.
      prisma.profesional.findMany(),
      prisma.turno.findMany({
        where: {
          fecha: hoy,
          estado: { in: ['LLAMADO', 'EN_ATENCION'] },
          moduloId: { not: null },
          horaLlamado: { not: null },
        },
        orderBy: { horaLlamado: 'asc' },
      }),
      prisma.cita.findMany({
        where: { fecha: hoy, estado: { not: 'CANCELADA' } },
        select: { profesionalId: true },
      }),
      // LA COLA DE HOY, para poder decir quien entra despues en cada
      // consultorio (ver `siguienteCodigo` en `CasillaPantalla`).
      //
      // Se piden TODOS los que esperan en UNA consulta y se agrupan en
      // memoria, en vez de preguntar por cada consultorio: con veinte
      // consultorios encendidos eso serian veinte consultas mas en cada
      // refresco de cada televisor, contra la misma base que atiende el
      // mostrador. Solo se traen las tres columnas que hacen falta.
      prisma.turno.findMany({
        where: { fecha: hoy, estado: 'EN_ESPERA', profesionalId: { not: null } },
        select: { codigo: true, profesionalId: true, prioridad: true, fechaGeneracion: true },
      }),
      prisma.turno.findMany({
        where: { fecha: hoy, moduloId: { not: null } },
        select: { moduloId: true },
        distinct: ['moduloId'],
      }),
      cargarConfiguracion(),
      // Las CANCELADAS tambien cuentan: ver la nota de `hayAgendaDelDia`. Lo
      // que se pregunta es si la agenda del dia se subio, no si queda alguna
      // cita viva.
      prisma.cita.count({ where: { fecha: hoy } }),
    ])

    const servicioPorId = new Map(servicios.map((s) => [s.id, s]))
    const profesionales = todosLosProfesionales.filter((p) => p.activo)
    const profesionalPorId = new Map(profesionales.map((p) => [p.id, p]))

    // El consultorio de una cita sale del doctor: la cita no guarda modulo,
    // guarda a quien atiende, y el consultorio es donde ese doctor esta puesto.
    const moduloDelProfesional = new Map(todosLosProfesionales.map((p) => [p.id, p.moduloId]))
    const profesionalesConCita = new Set(citasDeHoy.map((c) => c.profesionalId))
    const modulosConCita = new Set(
      [...profesionalesConCita].map((id) => moduloDelProfesional.get(id)).filter(Boolean) as string[],
    )

    const visibles = modulosVisiblesEnPantalla({
      modulos: todosLosModulos,
      serviciosDeVentanilla: new Set(
        servicios.filter((s) => s.modoFila === 'COMPARTIDA').map((s) => s.id),
      ),
      conCitasHoy: modulosConCita,
      conTurnosHoy: new Set(turnosDeHoy.map((t) => t.moduloId!)),
      conProfesionalAsignado: new Set(
        profesionales.map((p) => p.moduloId).filter(Boolean) as string[],
      ),
      hayAgendaDelDia: citasRegistradasHoy > 0,
    })
    const modulos = todosLosModulos.filter((modulo) => visibles.has(modulo.id))

    // Los doctores que hoy NO tienen ni una cita no rotulan ninguna casilla.
    // El nombre salia de la jornada habitual de la ficha, asi que el medico que
    // hoy no vino aparecia igual con su nombre en la puerta y el paciente
    // entraba a preguntar por alguien que no estaba.
    //
    // El dia sin agenda cargada es la excepcion: ahi nadie tiene citas y
    // recortar por ellas dejaria todas las puertas sin nombre.
    //
    // Se pregunta al conjunto, no se recorre la lista de citas por cada doctor:
    // con 40 doctores y 1.500 citas del dia eran 60.000 comparaciones en cada
    // refresco de cada televisor, para una respuesta que el `Set` de arriba ya
    // tiene resuelta.
    const profesionalesDeHoy =
      citasRegistradasHoy > 0
        ? profesionales.filter((p) => profesionalesConCita.has(p.id))
        : profesionales

    // El ultimo llamado de cada PUESTO (consultorio + doctor): un consultorio
    // puede tener varios doctores atendiendo a la vez. La lista viene
    // ascendente, asi que el que quede en el mapa es el mas reciente.
    const ultimoPorPuesto = new Map<string, FilaTurno>()
    for (const turno of llamados) ultimoPorPuesto.set(puestoDe(turno.moduloId!, turno.profesionalId), turno)
    const puestosPorModulo = new Map<string, FilaTurno[]>()
    for (const turno of ultimoPorPuesto.values()) {
      puestosPorModulo.set(turno.moduloId!, [...(puestosPorModulo.get(turno.moduloId!) ?? []), turno])
    }

    /*
     * EL PROXIMO DE CADA DOCTOR.
     *
     * Se queda solo con el PRIMERO de cada cola, no con la cola entera: es lo
     * unico que la pantalla muestra, y guardar el resto seria pasear cientos
     * de turnos por memoria en cada refresco de cada televisor.
     *
     * El criterio de "primero" es EL MISMO que aplica `llamarSiguiente`
     * —prioritarios delante y, a igual prioridad, el que lleva mas tiempo
     * esperando—, no un orden parecido. Si fueran dos criterios distintos, la
     * pantalla anunciaria a un paciente y el doctor llamaria a otro, que es
     * peor que no anunciar nada.
     */
    const proximoPorProfesional = new Map<string, { codigo: string } & PuestoEnLaFila>()
    for (const turno of enEsperaDeHoy) {
      const candidato = {
        codigo: turno.codigo,
        prioridad: turno.prioridad,
        // Directo y no por `iso()`: esa admite null y aqui la columna nunca lo
        // es, asi que pasar por ella solo ensuciaria el tipo con un null que
        // no puede ocurrir.
        fechaGeneracion: turno.fechaGeneracion.toISOString(),
      }
      const actual = proximoPorProfesional.get(turno.profesionalId!)
      if (!actual || ordenAtencion(candidato, actual) < 0) {
        proximoPorProfesional.set(turno.profesionalId!, candidato)
      }
    }

    const bloqueAhora = jornadaActual(configuracion)

    /*
     * Quien entra despues en ESTA casilla, o null si no se puede prometer.
     *
     * Se calcula sobre el doctor que rotula la casilla, porque la cola es
     * suya. En una VENTANILLA DE FILA COMPARTIDA no hay doctor y la cola es de
     * todos: el primero de esa fila se lo lleva la ventanilla que pulse antes,
     * asi que anunciarlo en una casilla concreta mandaria al paciente a la
     * ventanilla equivocada. Ahi se devuelve null y la pantalla no muestra
     * nada, que es la respuesta honesta.
     */
    const proximoDeLaCasilla = (moduloId: string) => {
      const doctor = profesionalDeTurnoEn(moduloId, profesionalesDeHoy, bloqueAhora)
      if (!doctor) return null
      return proximoPorProfesional.get(doctor.id)?.codigo ?? null
    }

    const casillas = modulos.flatMap((modulo): CasillaPantalla[] => {
      // Con alguien atendiendo: una casilla por doctor, en el orden en que llamaron.
      const enCurso = puestosPorModulo.get(modulo.id) ?? []
      if (enCurso.length > 0) {
        return enCurso.map((turno) => {
          const servicio = servicioPorId.get(turno.servicioId)
          return {
            moduloId: modulo.id,
            puesto: puestoDe(modulo.id, turno.profesionalId),
            moduloNombre: modulo.nombre,
            servicioId: servicio?.id ?? '',
            servicioNombre: servicio?.nombre ?? 'Ventanilla',
            profesionalNombre: turno.profesionalId
              ? (profesionalPorId.get(turno.profesionalId)?.nombre ?? null)
              : null,
            codigo: turno.codigo,
            horaLlamado: iso(turno.horaLlamado),
            vecesLlamado: turno.vecesLlamado,
            siguienteCodigo: turno.profesionalId
              ? (proximoPorProfesional.get(turno.profesionalId)?.codigo ?? null)
              : proximoDeLaCasilla(modulo.id),
          }
        })
      }

      const servicio = modulo.servicioId ? servicioPorId.get(modulo.servicioId) : null
      return [{
        moduloId: modulo.id,
        moduloNombre: modulo.nombre,
        servicioId: servicio?.id ?? '',
        servicioNombre: servicio?.nombre ?? 'Ventanilla',
        // Solo profesionales ACTIVOS Y CON CITAS HOY, y de ellos EL DE LA
        // JORNADA QUE CORRE. Un consultorio suele compartirse entre un doctor
        // de mañana y uno de tarde: cogiendo el primero de la lista, el
        // televisor mostraba al de la mañana toda la tarde y el paciente
        // entraba preguntando por alguien que ya se habia ido.
        profesionalNombre:
          profesionalDeTurnoEn(modulo.id, profesionalesDeHoy, bloqueAhora)?.nombre ?? null,
        codigo: null,
        horaLlamado: null,
        vecesLlamado: 0,
        // El consultorio esta libre pero puede tener gente esperando: mostrar
        // quien es el proximo avisa al paciente de que se acerque antes de que
        // lo llamen, que es justo el rato que se pierde en la practica.
        siguienteCodigo: proximoDeLaCasilla(modulo.id),
      }]
    })

    return { casillas, configuracion }
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
      take: filtro.limite,
      // El documento del paciente vive en la cita: sin el, el reporte decia
      // que turno se atendio pero no a quien.
      include: { cita: { select: { documentoPaciente: true, tipoDocumento: true, procedimiento: true } } },
    })
    return filas.map(({ cita, ...fila }) => ({
      ...aTurno(fila),
      documentoPaciente: cita?.documentoPaciente ?? null,
      tipoDocumento: cita?.tipoDocumento ?? null,
      procedimiento: cita?.procedimiento ?? null,
    }))
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
    await validarNombreDeServicioLibre(nombre)

    // El prefijo y el nombre los defiende la base, no solo las validaciones de
    // arriba: dos administradores dando de alta servicios a la vez (o una carga
    // del reporte corriendo en medio) pasaban las dos comprobaciones y dejaban
    // dos servicios con la misma letra COMPARTIENDO la numeracion del dia.
    const fila = await conUnicidadRespaldada(
      { ...avisosDeNombreRepetido('servicio', nombre), prefijo: YA_EXISTE.prefijo(prefijo) },
      () =>
        prisma.servicio.create({
          data: { nombre, prefijo, modoFila: datos.modoFila, activo: datos.activo },
        }),
    )
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
    if (datos.nombre !== undefined) {
      const nombre = datos.nombre.trim()
      await validarNombreDeServicioLibre(nombre, id)
      cambios.nombre = nombre
    }
    if (datos.modoFila !== undefined && datos.modoFila !== servicio.modoFila) {
      await validarCambioDeModoFila(servicio, datos.modoFila)
      cambios.modoFila = datos.modoFila
    }
    if (datos.activo !== undefined) cambios.activo = datos.activo

    const fila = await conUnicidadRespaldada(
      {
        ...avisosDeNombreRepetido('servicio', String(cambios.nombre ?? servicio.nombre)),
        prefijo: YA_EXISTE.prefijo(String(cambios.prefijo ?? servicio.prefijo)),
      },
      () => prisma.servicio.update({ where: { id }, data: cambios }),
    )
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

    const fila = await conUnicidadRespaldada(avisosDeNombreRepetido('modulo', nombre), () =>
      prisma.modulo.create({
        data: { nombre, servicioId: datos.servicioId ?? null, activo: datos.activo },
      }),
    )
    return aModulo(fila)
  }

  async actualizarModulo(id: string, datos: Partial<Omit<Modulo, 'id'>>): Promise<Modulo> {
    const modulo = await exigirModulo(id)
    if (datos.servicioId) await exigirServicio(datos.servicioId)

    const cambios: Prisma.ModuloUncheckedUpdateInput = {}
    if (datos.nombre !== undefined) {
      const nombre = datos.nombre.trim()
      await validarNombreDeModuloLibre(nombre, id)
      cambios.nombre = nombre
    }
    if (datos.servicioId !== undefined) cambios.servicioId = datos.servicioId || null
    if (datos.activo !== undefined) {
      if (datos.activo === false) {
        await validarModuloSinPacienteDentro(id)
        await validarModuloSinDoctoresConPacientes(modulo)
      }
      cambios.activo = datos.activo
    }

    const fila = await conUnicidadRespaldada(
      avisosDeNombreRepetido('modulo', String(cambios.nombre ?? modulo.nombre)),
      () => prisma.modulo.update({ where: { id }, data: cambios }),
    )
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

    await validarNombreDeProfesionalLibre(nombre)

    const fila = await conUnicidadRespaldada(avisosDeNombreRepetido('profesional', nombre), () =>
      prisma.profesional.create({
        data: {
          nombre,
          servicioId: servicio.id,
          jornada: datos.jornada,
          moduloId: datos.moduloId || null,
          activo: true,
        },
      }),
    )
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
      // Faltaba al EDITAR: crear si comprobaba el nombre repetido y renombrar
      // no, asi que corregirle el nombre a un doctor para dejarlo igual que
      // otra ficha —muy probable despues de una carga, que crea fichas
      // "X (importado)"— reventaba contra el indice de la base.
      await validarNombreDeProfesionalLibre(nombre, id)
      cambios.nombre = nombre
    }

    if (datos.servicioId !== undefined && datos.servicioId !== profesional.servicioId) {
      const servicio = await exigirServicio(datos.servicioId)
      validarServicioDeProfesional(servicio)

      // Las citas ya agendadas guardan el servicio: cambiarselo aqui las
      // dejaria apuntando al anterior. Es mas honesto pedir que se resuelva la
      // agenda primero que mover al doctor y dejar el dia torcido.
      // De hoy en adelante: una inasistencia vieja se queda en PROGRAMADA para
      // siempre y bloqueaba el cambio sin remedio.
      const conCitas = await prisma.cita.count({
        where: { profesionalId: id, estado: 'PROGRAMADA', fecha: { gte: diaColombia(ahoraISO()) } },
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
          where: { profesionalId: id, estado: 'PROGRAMADA', fecha: { gte: diaColombia(ahoraISO()) } },
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
      // Solo los de HOY: nada cierra los turnos de otro dia (todo lo que cierra
      // mira `pendientesDeHoy`), asi que uno que quedo LLAMADO ayer pedia
      // "cierra su atencion" sin forma de hacerlo.
      const abiertos = await prisma.turno.count({
        where: { profesionalId: id, fecha: diaColombia(ahoraISO()), estado: { in: ['EN_ESPERA', 'LLAMADO', 'EN_ATENCION'] } },
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

    const fila = await conUnicidadRespaldada(
      avisosDeNombreRepetido('profesional', String(cambios.nombre ?? profesional.nombre)),
      () => prisma.profesional.update({ where: { id }, data: cambios }),
    )
    return aProfesional(fila)
  }

  // --- Parametros generales ---

  async configuracion(): Promise<ConfiguracionGuardada> {
    return cargarConfiguracion()
  }

  async guardarConfiguracion(
    datos: Partial<ConfiguracionSistema>,
    opciones: { visto?: string } = {},
  ): Promise<ConfiguracionGuardada> {
    const actual = await cargarConfiguracion()
    // Aviso temprano, para no hacer trabajo en balde; el cierre de verdad es la
    // escritura condicionada del final.
    exigirConfiguracionAlDia(actual.actualizadoEn, opciones.visto)

    const { actualizadoEn: _marcaAnterior, ...parametrosActuales } = actual
    const siguiente: ConfiguracionSistema = { ...parametrosActuales, ...datos }

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

    // La escritura va condicionada a la marca que el administrador tenia
    // delante: si otro guardo en medio, no se escribe nada. `cargarConfiguracion`
    // ya creo la fila, asi que aqui solo se actualiza.
    const guardado = await prisma.configuracion.updateMany({
      where: {
        id: ID_CONFIGURACION,
        ...(opciones.visto ? { actualizadoEn: new Date(opciones.visto) } : {}),
      },
      data: siguiente,
    })
    if (guardado.count === 0) errorDeNegocio(CONFIGURACION_YA_CAMBIADA)

    // Se avisa DESPUES de escribir y solo si se escribio: las pantallas vuelven
    // a preguntar en cuanto llega esto, y avisar antes las haria leer todavia
    // lo viejo. Ver `configuracion.cambiada` en `lib/realtime/hub.ts`.
    realtimeHub.publish({ tipo: 'configuracion.cambiada' })

    return cargarConfiguracion()
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

    const acceso = await enTransaccion(async (tx) => {
      // Un doctor, un enlace activo: el anterior deja de servir en cuanto se
      // genera uno nuevo, para que no queden varias llaves vivas sueltas.
      // El anterior se revoca y ADEMAS pierde su copia cifrada en la misma
      // transaccion: un enlace que ya no abre nada tampoco tiene por que poder
      // volver a mostrarse en la pantalla de enlaces.
      await tx.accesoProfesional.updateMany({
        where: { profesionalId, revocadoEn: null },
        data: { revocadoEn: new Date(), tokenCifrado: null },
      })

      return tx.accesoProfesional.create({
        data: {
          profesionalId,
          // Lo que VALIDA la entrada es el hash, nunca el token guardado: un
          // volcado de la tabla sin la clave de cifrado no abre ningun
          // consultorio.
          tokenHash: hashToken(token),
          // Y aparte, la copia cifrada, que es lo que deja volver a enseñar el
          // enlace mientras el doctor esta en su turno. Se borra al revocarlo,
          // al generar otro y al vencer.
          //
          // SI EL CIFRADO FALLA, EL ENLACE SE GENERA IGUAL. Poder volver a
          // verlo es una comodidad; poder entrar al consultorio es la funcion.
          // Con `cifrar` llamado en seco, un despliegue sin el secreto en el
          // entorno —o una rotacion a medias— tumbaba la transaccion entera y
          // dejaba a TODO el hospital sin poder generar un solo enlace, aunque
          // la validacion por hash habria seguido funcionando perfectamente.
          tokenCifrado: cifrarSiSePuede(token),
          expiraEn: new Date(Date.now() + duracionMinutos * 60 * 1000),
        },
      })
    })

    return { acceso: aAcceso(acceso), token }
  }

  async expiracionDelAcceso(token: string): Promise<string | null> {
    if (!token) return null
    const acceso = await prisma.accesoProfesional.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { expiraEn: true, revocadoEn: true },
    })
    if (!acceso || acceso.revocadoEn) return null
    return acceso.expiraEn.toISOString()
  }

  async validarAccesoProfesional(token: string): Promise<Profesional | null> {
    if (!token) return null

    const acceso = await prisma.accesoProfesional.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { profesional: true },
    })
    if (!acceso) return null
    if (acceso.revocadoEn) return null

    if (acceso.expiraEn.getTime() <= Date.now()) {
      // VENCIDO: se aprovecha el paso por aqui para borrar la copia.
      //
      // El borrado estaba solo en `tokenVigenteDeProfesional`, es decir, solo
      // ocurria si alguien abria la pantalla de enlaces. Un enlace generado el
      // viernes que vencia esa noche, para un doctor al que nadie le vuelve a
      // generar otro, dejaba su copia descifrable en la tabla para siempre. El
      // doctor que reabre su pestaña vencida pasa por aqui, asi que este es el
      // camino que de verdad se recorre.
      if (acceso.tokenCifrado) {
        await prisma.accesoProfesional.update({
          where: { id: acceso.id },
          data: { tokenCifrado: null },
        })
      }
      return null
    }
    if (!acceso.profesional.activo) return null

    // Espaciado (ver `MS_ENTRE_APUNTES_DE_USO`): la condicion va en el propio
    // update, asi dos peticiones a la vez no escriben las dos.
    const haceUnRato = new Date(Date.now() - MS_ENTRE_APUNTES_DE_USO)
    if (!acceso.ultimoUsoEn || acceso.ultimoUsoEn < haceUnRato) {
      await prisma.accesoProfesional.updateMany({
        where: { id: acceso.id, OR: [{ ultimoUsoEn: null }, { ultimoUsoEn: { lt: haceUnRato } }] },
        data: { ultimoUsoEn: new Date() },
      })
    }
    return aProfesional(acceso.profesional)
  }

  /**
   * EL ULTIMO ACCESO DE CADA DOCTOR, no todos los que se han generado.
   *
   * La pantalla de enlaces solo usa el ultimo de cada uno —es el que esta
   * vigente, o el que hay que renovar— y esto devolvia el historial completo:
   * con dieciocho doctores renovando enlace a diario son varios miles de filas
   * al año viajando enteras al navegador en CADA carga de la pantalla, y
   * creciendo para siempre. El historial de accesos de un doctor, si algun dia
   * hace falta, esta en el registro de actividad.
   */
  async listarAccesosProfesional(): Promise<AccesoProfesional[]> {
    const filas = await prisma.accesoProfesional.findMany({
      orderBy: { creadoEn: 'desc' },
      distinct: ['profesionalId'],
    })
    return filas.map(aAcceso)
  }

  async revocarAccesoProfesional(id: string): Promise<AccesoProfesional> {
    const acceso = await prisma.accesoProfesional.findUnique({ where: { id } })
    if (!acceso) errorDeNegocio('El acceso indicado no existe.')

    // Ya revocado: se limpia igualmente por si quedo copia de una version
    // anterior del sistema. Revocar dos veces no puede dejar rastro legible.
    if (acceso.revocadoEn) {
      if (acceso.tokenCifrado) {
        await prisma.accesoProfesional.update({ where: { id }, data: { tokenCifrado: null } })
      }
      return aAcceso(acceso)
    }

    const fila = await prisma.accesoProfesional.update({
      where: { id },
      // El enlace deja de servir Y deja de poder mostrarse, en la misma
      // escritura: si se borrara despues, entre las dos habria una ventana en
      // la que el mostrador todavia podia enseñar un enlace ya muerto.
      data: { revocadoEn: new Date(), tokenCifrado: null },
    })
    return aAcceso(fila)
  }

  /** Ver `tokenVigenteDeProfesional` en el contrato del repositorio. */
  async tokenVigenteDeProfesional(profesionalId: string): Promise<string | null> {
    const acceso = await prisma.accesoProfesional.findFirst({
      where: { profesionalId, revocadoEn: null },
      orderBy: { creadoEn: 'desc' },
    })
    if (!acceso?.tokenCifrado) return null

    // Vencido: se limpia la copia al pasar por aqui. No hace falta una tarea
    // programada para que la tabla no acumule llaves muertas legibles.
    if (acceso.expiraEn.getTime() <= Date.now()) {
      await prisma.accesoProfesional.update({
        where: { id: acceso.id },
        data: { tokenCifrado: null },
      })
      return null
    }

    return descifrar(acceso.tokenCifrado)
  }
}

// ---------------------------------------------------------------------------
// Ayudas que necesitan la base de datos
// ---------------------------------------------------------------------------

/**
 * El turno que ese profesional llamara despues, o null si no queda nadie.
 *
 * Mismo criterio que `llamarSiguiente` y que `estadoPantalla`: el primero de su
 * cola, prioritarios delante (`ordenAtencion`). Se pide ordenado a la base y se
 * toma uno solo, porque aqui hace falta ese y nada mas.
 */
async function proximoDelProfesional(profesionalId: string | null): Promise<string | null> {
  if (!profesionalId) return null

  const proximo = await prisma.turno.findFirst({
    where: { fecha: diaColombia(ahoraISO()), estado: 'EN_ESPERA', profesionalId },
    orderBy: [{ prioridad: 'desc' }, { fechaGeneracion: 'asc' }],
    select: { codigo: true },
  })
  return proximo?.codigo ?? null
}

/**
 * Arma la casilla que ve la pantalla publica. NO lleva datos del paciente.
 *
 * LLEVA TAMBIEN EL PROXIMO, y tiene que llevarlo. Esta casilla es la que viaja
 * por el canal en vivo cuando alguien llama un turno, y la pantalla reemplaza
 * con ella la que tenia. Sin `siguienteCodigo`, cada llamado BORRABA de la
 * cartelera el aviso de "se estan preparando" de ese consultorio —justo en el
 * momento en que acaba de cambiar y mas util es— y no volvia hasta la
 * resincronizacion, hasta un minuto despues.
 */
async function casillaDeTurno(turno: FilaTurno): Promise<CasillaPantalla> {
  const [modulo, servicio, profesional, siguienteCodigo] = await Promise.all([
    turno.moduloId ? prisma.modulo.findUnique({ where: { id: turno.moduloId } }) : null,
    prisma.servicio.findUnique({ where: { id: turno.servicioId } }),
    turno.profesionalId ? prisma.profesional.findUnique({ where: { id: turno.profesionalId } }) : null,
    proximoDelProfesional(turno.profesionalId),
  ])

  return {
    moduloId: modulo?.id ?? '',
    puesto: puestoDe(modulo?.id ?? '', turno.profesionalId),
    moduloNombre: modulo?.nombre ?? '',
    servicioId: servicio?.id ?? '',
    servicioNombre: servicio?.nombre ?? 'Ventanilla',
    profesionalNombre: profesional?.nombre ?? null,
    codigo: turno.codigo,
    horaLlamado: iso(turno.horaLlamado),
    vecesLlamado: turno.vecesLlamado,
    siguienteCodigo,
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
/**
 * Los avisos de "ya existe", en un solo sitio.
 *
 * Los usan DOS caminos que tienen que decir lo mismo: la validacion que se hace
 * antes de escribir y la traduccion del rechazo del indice unico cuando otro
 * operador se adelanto. Con los textos copiados, el mismo choque se explicaba
 * de dos maneras segun quien llegara primero.
 */
const YA_EXISTE = {
  modulo: (nombre: string) =>
    `Ya existe "${nombre}". El paciente solo tiene ese nombre para saber por que puerta entrar, asi que no puede haber dos iguales.`,
  servicio: (nombre: string) => `Ya existe un servicio llamado "${nombre}".`,
  profesional: (nombre: string) => `Ya existe un profesional llamado "${nombre}".`,
  prefijo: (prefijo: string) => `El prefijo ${prefijo} ya lo usa otro servicio.`,
}

type Catalogo = 'modulo' | 'servicio' | 'profesional'

/**
 * Indices de la migracion que hacen cumplir la unicidad del nombre SIN
 * distinguir mayusculas ni espacios, que es como la compara la regla de
 * negocio y como lo lee el paciente. Estan escritos a mano sobre
 * `lower(trim(nombre))`, asi que Prisma los informa por su nombre.
 */
const INDICE_NOMBRE: Record<Catalogo, string> = {
  modulo: 'modulos_nombre_normalizado_unico',
  servicio: 'servicios_nombre_normalizado_unico',
  profesional: 'profesionales_nombre_normalizado_unico',
}

function avisosDeNombreRepetido(catalogo: Catalogo, nombre: string): Record<string, string> {
  const aviso = YA_EXISTE[catalogo](nombre)
  // `nombre` es el `@unique` exacto de Prisma; el otro, el indice normalizado.
  return { nombre: aviso, [INDICE_NOMBRE[catalogo]]: aviso }
}

async function validarNombreDeModuloLibre(nombre: string, exceptoId?: string) {
  if (!nombre) errorDeNegocio('El nombre del consultorio o la ventanilla es obligatorio.')

  const repetido = await prisma.modulo.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(exceptoId ? { id: { not: exceptoId } } : {}),
    },
    select: { id: true },
  })
  if (repetido) errorDeNegocio(YA_EXISTE.modulo(nombre))
}

/**
 * Un consultorio no se apaga con un paciente adentro.
 *
 * Apagarlo lo borra del televisor, y lo borra CON el turno ya llamado pintado
 * en su casilla: el paciente se queda sin saber por que puerta entrar, mirando
 * una pantalla donde su numero acaba de desaparecer. Y al doctor se le bloquea
 * el llamado desde ahi (`validarModuloParaLlamar`), asi que tampoco puede
 * cerrar al que tiene enfrente ni seguir con la fila.
 *
 * Es la misma idea que ya protege el modo de fila de un servicio: para dejar de
 * usar algo esta el interruptor, pero no a mitad de una atencion.
 */
async function validarModuloSinPacienteDentro(moduloId: string) {
  const abierto = await prisma.turno.findFirst({
    where: {
      moduloId,
      fecha: diaColombia(ahoraISO()),
      estado: { in: ['LLAMADO', 'EN_ATENCION'] },
    },
    select: { codigo: true },
  })

  if (abierto) {
    errorDeNegocio(
      `No se puede desactivar: el turno ${abierto.codigo} esta siendo atendido ahi. Espera a que el doctor lo cierre.`,
    )
  }
}

/**
 * Un consultorio no se apaga si algun doctor asignado ahi tiene pacientes hoy
 * (ver `motivoQueImpideDesactivarModulo`).
 */
async function validarModuloSinDoctoresConPacientes(modulo: FilaModulo) {
  const hoy = diaColombia(ahoraISO())
  const doctores = await prisma.profesional.findMany({
    where: { moduloId: modulo.id, activo: true },
    select: { id: true, nombre: true },
  })
  const conPacientes = await Promise.all(
    doctores.map(async (doctor) => ({ nombre: doctor.nombre, pacientesHoy: await pacientesDeHoyDe(doctor.id, hoy) })),
  )
  const motivo = motivoQueImpideDesactivarModulo(modulo.nombre, conPacientes)
  if (motivo) errorDeNegocio(motivo)
}

/** En espera hoy, mas los citados hoy que todavia no llegan. */
async function pacientesDeHoyDe(profesionalId: string, hoy: string): Promise<number> {
  const [enEspera, porLlegar] = await Promise.all([
    prisma.turno.count({ where: { profesionalId, fecha: hoy, estado: 'EN_ESPERA' } }),
    prisma.cita.count({ where: { profesionalId, fecha: hoy, estado: 'PROGRAMADA' } }),
  ])
  return enEspera + porLlegar
}

/**
 * Dos servicios no pueden llamarse igual, ni dos doctores.
 *
 * La base ya lo impide con un indice unico, pero reventar contra el indice no
 * es lo mismo que validarlo: el error de Prisma llega en ingles y con el nombre
 * de la columna dentro, y ahora `apiError` lo tapa entero con un mensaje
 * generico de "problema del sistema", que para un nombre repetido es peor
 * todavia. Se comprueba antes y se contesta en el idioma del funcionario.
 *
 * Se compara SIN distinguir mayusculas ni espacios, que es como lo lee una
 * persona: "Odontologia" y "ODONTOLOGIA" son el mismo servicio, y la carga del
 * reporte del hospital manda los nombres en mayusculas.
 */
async function validarNombreDeServicioLibre(nombre: string, exceptoId?: string) {
  const repetido = await prisma.servicio.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(exceptoId ? { id: { not: exceptoId } } : {}),
    },
    select: { id: true },
  })
  if (repetido) errorDeNegocio(YA_EXISTE.servicio(nombre))
}

async function validarNombreDeProfesionalLibre(nombre: string, exceptoId?: string) {
  const repetido = await prisma.profesional.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(exceptoId ? { id: { not: exceptoId } } : {}),
    },
    select: { id: true },
  })
  if (repetido) errorDeNegocio(YA_EXISTE.profesional(nombre))
}

async function validarPrefijoLibre(prefijo: string) {
  const repetido = await prisma.servicio.findFirst({ where: { prefijo }, select: { id: true } })
  if (repetido) errorDeNegocio(YA_EXISTE.prefijo(prefijo))
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

    // Solo citas VIVAS de hoy en adelante: las atendidas y las inasistencias
    // viejas son historico, y pedir "cancelalas" seria imposible de cumplir.
    const citas = await prisma.cita.count({
      where: { servicioId: servicio.id, estado: { in: ['PROGRAMADA', 'PRESENTADO'] }, fecha: { gte: diaColombia(ahoraISO()) } },
    })
    if (citas > 0) {
      errorDeNegocio(
        `${servicio.nombre} tiene ${citas} cita(s) agendada(s) que quedarian sin doctor. Atiendelas o cancelalas antes de pasarlo a ventanilla.`,
      )
    }
    return
  }

  // Solo los de HOY: los de otro dia ya no se llaman (ver `pendientesDeHoy`).
  const enFila = await prisma.turno.count({
    where: {
      servicioId: servicio.id,
      profesionalId: null,
      fecha: diaColombia(ahoraISO()),
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

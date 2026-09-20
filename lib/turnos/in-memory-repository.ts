/**
 * TEMPORAL / DEV - implementacion en memoria de `TurnoRepository`.
 *
 * La API del hospital AUN NO HA SIDO ENTREGADA. Mientras tanto, esta
 * implementacion sirve para desarrollar y hacer demos de las tres interfaces
 * contra el mismo contrato que usara el adaptador real
 * (`lib/hospital/hospital-api.adapter.ts`, pendiente).
 *
 * Los datos viven solo en memoria del proceso (via `globalThis`, para
 * sobrevivir al HMR de desarrollo). Se pierden al reiniciar el servidor.
 * NO usar en produccion como fuente de verdad.
 *
 * Los servicios, modulos, profesionales y citas sembrados aqui son datos DE
 * EJEMPLO inventados solo para el demo. Los nombres de paciente son ficticios:
 * no hay ni debe haber datos reales de pacientes en el repositorio.
 */
import { createHash, randomBytes } from 'node:crypto'
import { CONFIGURACION_INICIAL } from './configuracion-inicial'
import { MINUTOS_ACCESO_MAXIMO, MINUTOS_ACCESO_MINIMO } from './repository'
import type { TurnoRepository } from './repository'
import type {
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
  HorarioDia,
  EstadisticasDia,
  EstadoPantalla,
  EstadoAgendaItem,
  FiltroHistorico,
  ItemAgendaProfesional,
  JornadaDelDia,
  Jornada,
  Modulo,
  Profesional,
  Servicio,
  Turno,
} from './types'
import { errorDeNegocio } from './errores'
import { ordenAtencion, resumir } from './estadisticas'
import { reunirActividad } from './actividad'
import { modulosVisiblesEnPantalla } from './casillas'
import { motivoQueImpideCancelar, motivoQueImpideReprogramar } from './cita-transiciones'
import { exigirConfiguracionAlDia, marcaSiguiente } from './configuracion-version'
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
  franjasDeJornada,
  horaColombia,
  instanteDeFranja,
} from './tiempo'
import { realtimeHub } from '@/lib/realtime/hub'

interface EstadoMemoria {
  servicios: Servicio[]
  modulos: Modulo[]
  profesionales: Profesional[]
  citas: Cita[]
  turnos: Turno[]
  contadores: Record<string, number>
  configuracion: ConfiguracionGuardada
  /**
   * Solo se guarda el hash del token, nunca el token en claro (seccion 17:
   * minimizar datos sensibles; un enlace filtrado del estado no sirve para
   * entrar).
   */
  accesosProfesional: Array<AccesoProfesional & { tokenHash: string }>
}

function crearId() {
  return Math.random().toString(36).slice(2, 10)
}

function sembrar(): EstadoMemoria {
  // DOS servicios, los dos por cita: consulta externa y odontologia.
  //
  // Las especialidades de consulta externa (medicina interna, P y M,
  // pediatria, ginecologia, nutricion, psicologia, medicina general,
  // fisioterapia) NO son filas distintas ni se nombran en la pantalla: todas
  // cuelgan de consulta externa y el paciente ya sabe a que viene. Ponerle la
  // especialidad al consultorio solo lo confunde, porque tendria que buscar su
  // nombre en vez de leer el numero que le dieron en admisiones.
  //
  // Odontologia si va aparte, porque tiene sus propios consultorios y su
  // propio volumen de citas (bastante menor). Al ser otro servicio tiene su
  // propio prefijo de turno (O-001) y su propio bloque en la pantalla.
  //
  // El hospital NO usa filas de ventanilla por orden de llegada: todo se
  // atiende por cita. El sistema las sigue soportando (`modoFila`), y el dia
  // que hagan falta se crea el servicio desde la pantalla de Servicios y
  // aparece como un bloque mas, sin tocar codigo.
  const servicios: Servicio[] = [
    { id: 'srv-consulta-externa', nombre: 'Consulta externa', prefijo: 'C', modoFila: 'POR_PROFESIONAL', activo: true },
    { id: 'srv-odontologia', nombre: 'Odontologia', prefijo: 'O', modoFila: 'POR_PROFESIONAL', activo: true },
  ]

  // Los consultorios se llaman por su NUMERO y nada mas.
  //
  // Es lo que se acordo con el hospital: al paciente se le dice "turno C-014,
  // consultorio 3" y con eso llega. Rotularlos con la especialidad
  // ("CONS 03 - P y M") obliga al paciente a interpretar a que servicio
  // pertenece su cita, que es justo lo que no tiene por que saber.
  //
  // La numeracion es CORRIDA entre los dos servicios (odontologia sigue en el
  // 9 y el 10) para que nunca haya dos "Consultorio 1" en la misma pantalla:
  // el numero tiene que identificar una sola puerta del edificio.
  const modulos: Modulo[] = [
    { id: 'mod-consultorio-1', nombre: 'Consultorio 1', servicioId: 'srv-consulta-externa', activo: true },
    { id: 'mod-consultorio-2', nombre: 'Consultorio 2', servicioId: 'srv-consulta-externa', activo: true },
    { id: 'mod-consultorio-3', nombre: 'Consultorio 3', servicioId: 'srv-consulta-externa', activo: true },
    { id: 'mod-consultorio-4', nombre: 'Consultorio 4', servicioId: 'srv-consulta-externa', activo: true },
    { id: 'mod-consultorio-5', nombre: 'Consultorio 5', servicioId: 'srv-consulta-externa', activo: true },
    { id: 'mod-consultorio-6', nombre: 'Consultorio 6', servicioId: 'srv-consulta-externa', activo: true },
    { id: 'mod-consultorio-7', nombre: 'Consultorio 7', servicioId: 'srv-consulta-externa', activo: true },
    { id: 'mod-consultorio-8', nombre: 'Consultorio 8', servicioId: 'srv-consulta-externa', activo: true },
    { id: 'mod-consultorio-9', nombre: 'Consultorio 9', servicioId: 'srv-odontologia', activo: true },
    { id: 'mod-consultorio-10', nombre: 'Consultorio 10', servicioId: 'srv-odontologia', activo: true },
  ]

  // Mitad de mañana y mitad de tarde, que es como trabaja el hospital, para
  // que el horario de ejemplo muestre las dos jornadas con doctores en cada
  // una. Dr. Ramirez atiende el dia completo.
  // Ocho doctores en consulta externa y dos en odontologia, que es la
  // proporcion que describio el hospital (odontologia mueve bastantes menos
  // citas). Cada uno en su consultorio habitual.
  const profesionales: Profesional[] = [
    { id: 'pro-perez', nombre: 'Dr. Perez', servicioId: 'srv-consulta-externa', jornada: 'MANANA', moduloId: 'mod-consultorio-1', activo: true },
    { id: 'pro-gomez', nombre: 'Dra. Gomez', servicioId: 'srv-consulta-externa', jornada: 'MANANA', moduloId: 'mod-consultorio-2', activo: true },
    { id: 'pro-rios', nombre: 'Dra. Rios', servicioId: 'srv-consulta-externa', jornada: 'MANANA', moduloId: 'mod-consultorio-3', activo: true },
    { id: 'pro-ramirez', nombre: 'Dr. Ramirez', servicioId: 'srv-consulta-externa', jornada: 'COMPLETA', moduloId: 'mod-consultorio-4', activo: true },
    { id: 'pro-torres', nombre: 'Dr. Torres', servicioId: 'srv-consulta-externa', jornada: 'TARDE', moduloId: 'mod-consultorio-5', activo: true },
    { id: 'pro-mejia', nombre: 'Dra. Mejia', servicioId: 'srv-consulta-externa', jornada: 'TARDE', moduloId: 'mod-consultorio-6', activo: true },
    { id: 'pro-lopez', nombre: 'Dra. Lopez', servicioId: 'srv-consulta-externa', jornada: 'TARDE', moduloId: 'mod-consultorio-7', activo: true },
    { id: 'pro-castro', nombre: 'Dra. Castro', servicioId: 'srv-consulta-externa', jornada: 'TARDE', moduloId: 'mod-consultorio-8', activo: true },

    // Odontologia.
    { id: 'pro-salas', nombre: 'Dr. Salas', servicioId: 'srv-odontologia', jornada: 'MANANA', moduloId: 'mod-consultorio-9', activo: true },
    { id: 'pro-vega', nombre: 'Dr. Vega', servicioId: 'srv-odontologia', jornada: 'TARDE', moduloId: 'mod-consultorio-10', activo: true },
  ]

  const citas = sembrarCitas(profesionales, CONFIGURACION_INICIAL)

  return {
    servicios,
    modulos,
    profesionales,
    citas,
    turnos: [],
    contadores: {},
    configuracion: { ...CONFIGURACION_INICIAL, actualizadoEn: ahoraISO() },
    accesosProfesional: [],
  }
}

/** Nombres ficticios para el demo. No hay ni debe haber pacientes reales. */
const PACIENTES_DE_EJEMPLO = [
  'Juan Carlos Perez Gomez',
  'Maria Fernanda Lopez Diaz',
  'Pedro Antonio Ruiz Mora',
  'Ana Lucia Martinez Vega',
  'Carlos Andres Herrera Sosa',
  'Luisa Fernanda Castro Niño',
  'Jorge Eliecer Pacheco Luna',
  'Sofia Alejandra Nuñez Paz',
  'Miguel Angel Duran Rojas',
  'Diana Patricia Osorio Vanegas',
  'Ricardo Andres Bermudez Cano',
  'Camila Andrea Salcedo Toro',
  'Esteban David Quintero Arias',
  'Paola Andrea Villamil Prada',
  'Julian Esteban Cardenas Roa',
  'Natalia Andrea Beltran Ospina',
  'Sergio Andres Montoya Diaz',
  'Valentina Reyes Guerrero',
  'Samuel David Cifuentes Leon',
  'Isabella Rodriguez Pena',
  'Mateo Alejandro Sierra Buitrago',
  'Laura Sofia Mendoza Arrieta',
  'Andres Felipe Guzman Rada',
  'Daniela Marcela Vargas Cera',
  'Kevin Santiago Palencia Ruiz',
  'Angie Paola Contreras Meza',
  'Brayan Steven Oviedo Tapias',
  'Yuranis del Carmen Bello Pai',
  'Cristian Camilo Herazo Vides',
  'Melissa Andrea Buelvas Otero',
]

/**
 * Citas de ejemplo del dia, colocadas en franjas REALES de la jornada de cada
 * doctor.
 *
 * Se calculan desde la configuracion en vez de escribirlas a mano porque las
 * horas validas dependen de la duracion de la consulta: unas citas fijas a las
 * 8:20 dejarian de encajar en cuanto el administrador cambiara la consulta a
 * 10 minutos, y apareceria media agenda de ejemplo "fuera de horario".
 */
function sembrarCitas(profesionales: Profesional[], configuracion: ConfiguracionSistema): Cita[] {
  const CITAS_POR_DOCTOR = 3
  const hoy = diaColombia(new Date().toISOString())
  const citas: Cita[] = []

  const franjasDe = (jornada: Jornada) =>
    jornada === 'TARDE'
      ? franjasDeJornada(
          configuracion.jornadaTardeInicio,
          configuracion.jornadaTardeFin,
          configuracion.duracionCitaMinutos,
        )
      : franjasDeJornada(
          configuracion.jornadaMananaInicio,
          configuracion.jornadaMananaFin,
          configuracion.duracionCitaMinutos,
        )

  for (const profesional of profesionales) {
    if (!profesional.activo) continue

    // Se dejan libres las primeras franjas y se empieza un poco mas adelante,
    // para que el horario de ejemplo no se vea todo lleno de arriba abajo.
    const franjas = franjasDe(profesional.jornada).slice(2)

    for (const hora of franjas.slice(0, CITAS_POR_DOCTOR)) {
      citas.push({
        id: crearId(),
        documentoPaciente: String(1067890123 + citas.length),
        nombrePaciente: PACIENTES_DE_EJEMPLO[citas.length % PACIENTES_DE_EJEMPLO.length],
        profesionalId: profesional.id,
        servicioId: profesional.servicioId,
        horaCita: instanteDeFranja(hoy, hora),
        estado: 'PROGRAMADA',
      })
    }
  }

  return citas
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * El estado sobrevive al HMR guardandose en `globalThis`. Si la FORMA de
 * `EstadoMemoria` cambia (se agrega una coleccion nueva), el estado viejo
 * quedaria incompleto y reventaria en tiempo de ejecucion. La version fuerza a
 * volver a sembrar cuando eso pasa: subela al cambiar la estructura.
 */
const VERSION_ESTADO = 12

declare global {
  var __turnosMemoria: (EstadoMemoria & { version: number }) | undefined
}

const guardado = globalThis.__turnosMemoria
const estado: EstadoMemoria & { version: number } =
  guardado?.version === VERSION_ESTADO ? guardado : { ...sembrar(), version: VERSION_ESTADO }

// Se guarda SIEMPRE, tambien en produccion. Antes solo se hacia en desarrollo
// (para el HMR) y eso hacia que un despliegue real perdiera los cambios: cada
// vez que Next evaluaba el modulo en otro contexto se volvia a sembrar, y lo
// que el administrador acababa de crear o editar desaparecia sin dar error.
globalThis.__turnosMemoria = estado

/**
 * A que jornada pertenece una franja, o `null` si esa hora no es una franja
 * valida de ninguna de las dos.
 *
 * Se compara contra las franjas generadas y no contra el rango a secas, porque
 * lo que importa no es solo "esta dentro del horario" sino "cae justo en un
 * cupo": las 8:07 estan dentro de la mañana, pero no son una hora de consulta
 * si las citas van cada 15 minutos.
 */
function bloqueDeFranja(hora: string): 'MANANA' | 'TARDE' | null {
  const c = estado.configuracion

  if (franjasDeJornada(c.jornadaMananaInicio, c.jornadaMananaFin, c.duracionCitaMinutos).includes(hora)) {
    return 'MANANA'
  }
  if (franjasDeJornada(c.jornadaTardeInicio, c.jornadaTardeFin, c.duracionCitaMinutos).includes(hora)) {
    return 'TARDE'
  }
  return null
}

/**
 * En que jornada estamos AHORA, segun la hora de Colombia.
 *
 * Se parte por el fin de la jornada de la mañana: antes de esa hora es mañana,
 * despues es tarde. No hace falta afinar mas, porque esto solo decide que
 * nombre de doctor se rotula en una casilla libre.
 */
function jornadaActual(): 'MANANA' | 'TARDE' {
  const ahora = aMinutos(horaColombia(ahoraISO()))
  const finManana = aMinutos(estado.configuracion.jornadaMananaFin)
  if (!Number.isFinite(ahora) || !Number.isFinite(finManana)) return 'MANANA'
  return ahora < finManana ? 'MANANA' : 'TARDE'
}

/**
 * Que doctor rotular en un consultorio que ahora mismo no esta llamando.
 *
 * Un consultorio suele tener dos doctores asignados, uno por jornada. Se elige
 * el de la jornada que corre; si ninguno encaja (por ejemplo fuera de horario)
 * se deja el primero activo, que es mejor que dejar la casilla sin nombre.
 */
function profesionalDeTurnoEn(moduloId: string, soloEstos?: Set<string>): Profesional | undefined {
  // `soloEstos` acota a los doctores que ese dia TIENEN pacientes: el medico
  // que hoy no vino no puede rotular la puerta, o el paciente entra a preguntar
  // por alguien que no esta.
  const delModulo = estado.profesionales.filter(
    (p) => p.activo && p.moduloId === moduloId && (!soloEstos || soloEstos.has(p.id)),
  )
  if (delModulo.length <= 1) return delModulo[0]

  const bloque = jornadaActual()
  // Se prefiere al que atiende SOLO esa jornada antes que al de dia completo:
  // si comparten consultorio, el de jornada partida es el que esta adentro.
  return (
    delModulo.find((p) => p.jornada === bloque) ??
    delModulo.find((p) => atiendeEnJornada(p, bloque)) ??
    delModulo[0]
  )
}

function buscarServicio(servicioId: string): Servicio {
  const servicio = estado.servicios.find((s) => s.id === servicioId)
  if (!servicio) errorDeNegocio('El servicio indicado no existe.')
  return servicio
}

function buscarProfesional(profesionalId: string): Profesional {
  const profesional = estado.profesionales.find((p) => p.id === profesionalId)
  if (!profesional) errorDeNegocio('El profesional indicado no existe.')
  return profesional
}

function buscarModulo(moduloId: string): Modulo {
  const modulo = estado.modulos.find((m) => m.id === moduloId)
  if (!modulo) errorDeNegocio('El modulo indicado no existe.')
  return modulo
}

function buscarTurno(turnoId: string): Turno {
  const turno = estado.turnos.find((t) => t.id === turnoId)
  if (!turno) errorDeNegocio('El turno indicado no existe.')
  return turno
}

/**
 * Un profesional solo tiene sentido en un servicio POR_PROFESIONAL.
 *
 * En los servicios de ventanilla la fila es compartida y la toma quien este
 * libre (ver `ModoFila` en `types.ts`): un doctor asignado ahi no tendria
 * fila propia que llamar, y las citas que se le agendaran no llegarian a
 * ninguna parte.
 */
/**
 * El modo de fila de un servicio no se cambia con gente dentro.
 *
 * `modoFila` no es una etiqueta: decide POR DONDE entra el paciente. Con
 * POR_PROFESIONAL cada doctor tiene su agenda y llama a los suyos; con
 * COMPARTIDA hay una sola fila por orden de llegada y nadie tiene doctor
 * asignado. Cambiarlo con datos vivos deja pacientes que no se pueden atender,
 * y ninguna pantalla muestra un error: simplemente no aparecen.
 *
 * De POR_PROFESIONAL a COMPARTIDA: los doctores quedan colgando de un servicio
 * que "no lleva profesionales asignados" (justo lo que `crearProfesional`
 * prohibe), y las citas ya agendadas dejan de poder reprogramarse porque
 * `reprogramarCita` las rechaza por ese mismo motivo. El paciente ya tiene su
 * hora dada y nadie se la puede mover.
 *
 * De COMPARTIDA a POR_PROFESIONAL: los turnos que estaban en la fila NO TIENEN
 * profesional, y a partir del cambio a los pacientes se les llama desde la
 * pantalla del doctor, que busca por profesional. Esos turnos se quedan en la
 * cola para siempre, sin que nadie los vea ni los pueda llamar.
 *
 * Para dejar de usar un servicio esta el interruptor de activo/inactivo, que no
 * rompe nada de lo que ya empezo.
 */
function validarCambioDeModoFila(servicio: Servicio, nuevoModo: Servicio['modoFila']) {
  if (nuevoModo === 'COMPARTIDA') {
    const profesionales = estado.profesionales.filter((p) => p.servicioId === servicio.id)
    if (profesionales.length > 0) {
      errorDeNegocio(
        `${servicio.nombre} tiene ${profesionales.length} profesional(es) asignado(s), y un servicio de ventanilla no lleva profesionales. Muevelos a otro servicio antes de cambiar el modo de fila.`,
      )
    }

    const citas = estado.citas.filter((c) => c.servicioId === servicio.id && c.estado !== 'CANCELADA')
    if (citas.length > 0) {
      errorDeNegocio(
        `${servicio.nombre} tiene ${citas.length} cita(s) agendada(s) que quedarian sin doctor. Atiendelas o cancelalas antes de pasarlo a ventanilla.`,
      )
    }
    return
  }

  // Hacia POR_PROFESIONAL: lo que estorba son los turnos que ya estan en la
  // fila sin doctor, porque a partir del cambio solo se llama por doctor.
  const enFila = estado.turnos.filter(
    (t) =>
      t.servicioId === servicio.id &&
      !t.profesionalId &&
      (t.estado === 'EN_ESPERA' || t.estado === 'LLAMADO' || t.estado === 'EN_ATENCION'),
  )
  if (enFila.length > 0) {
    errorDeNegocio(
      `${servicio.nombre} tiene ${enFila.length} paciente(s) en la fila sin doctor asignado. Atiendelos antes de pasarlo a atencion por cita, o se quedarian en la cola sin que nadie pueda llamarlos.`,
    )
  }
}

function validarServicioDeProfesional(servicio: Servicio) {
  if (servicio.modoFila !== 'POR_PROFESIONAL') {
    errorDeNegocio(
      `${servicio.nombre} atiende por ventanilla (orden de llegada), asi que no lleva profesionales asignados.`,
    )
  }
}

/**
 * La cita tiene que caber en la parrilla.
 *
 * Las tres reglas de aqui son las que hacen que la agenda sea un horario y no
 * una lista: cada cita ocupa un cupo real de un doctor que de verdad trabaja a
 * esa hora, y ese cupo no se puede dar dos veces. El tope de citas por dia sale
 * solo de aqui, sin numero aparte: son las franjas que caben en su jornada.
 *
 * Vive suelta (y no dentro de `crearCita`) porque REPROGRAMAR es volver a
 * agendar y tiene que pasar por exactamente lo mismo. Con las reglas
 * duplicadas, mover una cita habria sido la puerta de atras para meter
 * pacientes fuera de horario o dos en el mismo cupo.
 */
function validarFranjaDeCita(params: {
  horaCita: string
  profesional: Profesional
  /** Cita que no cuenta como ocupante del cupo (la que se esta moviendo). */
  ignorarCitaId?: string
}) {
  const { horaCita, profesional, ignorarCitaId } = params

  if (Number.isNaN(new Date(horaCita).getTime())) errorDeNegocio('La hora de la cita no es valida.')

  // No se agenda en un dia que ya paso. Esas citas nacen muertas: nadie va a
  // registrar esa llegada, y se quedan en PROGRAMADA para siempre, ensuciando
  // la agenda y contando como inasistencia. Se comprueba el DIA y no la hora
  // exacta, porque agendar a una hora ya pasada del dia de hoy si es una
  // operacion normal del mostrador (el paciente que llega tarde).
  const diaDeLaCita = diaColombia(horaCita)
  if (diaDeLaCita < diaColombia(ahoraISO())) {
    errorDeNegocio(`El ${diaDeLaCita} ya paso. Elige la fecha de hoy o una posterior.`)
  }

  const hora = horaColombia(horaCita)
  const bloque = bloqueDeFranja(hora)
  if (!bloque) {
    const c = estado.configuracion
    errorDeNegocio(
      `Las ${hora} no son una hora de consulta. Las citas van cada ${c.duracionCitaMinutos} minutos, de ${c.jornadaMananaInicio} a ${c.jornadaMananaFin} y de ${c.jornadaTardeInicio} a ${c.jornadaTardeFin}.`,
    )
  }

  // Las citas que el doctor YA tiene ese dia: dicen que jornada trabaja ese
  // dia y si la hora esta ocupada.
  const citasDelDia = estado.citas.filter(
    (c) =>
      c.profesionalId === profesional.id &&
      c.estado !== 'CANCELADA' &&
      diaColombia(c.horaCita) === diaDeLaCita,
  )

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
    estado.configuracion,
  )

  if (!atiendeEnJornada(profesional, bloque) && !conPacientes.has(bloque)) {
    errorDeNegocio(
      `${profesional.nombre} atiende en ${ETIQUETA_JORNADA[profesional.jornada]} y el ${diaDeLaCita} no tiene pacientes en la otra, asi que no se le puede agendar a las ${hora}.`,
    )
  }

  const ocupada = citasDelDia.some(
    (c) => c.id !== ignorarCitaId && horaColombia(c.horaCita) === hora,
  )
  if (ocupada) {
    errorDeNegocio(`${profesional.nombre} ya tiene un paciente a las ${hora}. Elige otra hora.`)
  }
}

/**
 * Un doctor solo puede llamar en un consultorio que sea suyo.
 *
 * Sin esta comprobacion, el `moduloId` viajaba en el cuerpo de la peticion sin
 * que nadie lo contrastara con quien lo mandaba, y bastaba un id equivocado
 * para llamar en la puerta de otro. Eso no era solo un numero mal puesto en la
 * pantalla: al llamar, `cerrarAtencionAbierta` da por ATENDIDO al paciente que
 * ese consultorio tuviera adentro, asi que un doctor le cerraba la atencion a
 * otro sin enterarse ninguno de los dos. El caso llegaba solo por la interfaz:
 * un doctor sin consultorio asignado caia en el primero de su servicio.
 *
 * Las tres reglas:
 *   1. El consultorio tiene que estar activo.
 *   2. Tiene que ser de su servicio (o no estar asignado a ninguno).
 *   3. No puede haber OTRO profesional atendiendo ahi en este momento.
 */
function validarModuloParaLlamar(modulo: Modulo, profesionalId?: string) {
  if (!modulo.activo) {
    errorDeNegocio(`${modulo.nombre} esta desactivado; no se puede llamar desde ahi.`)
  }

  if (!profesionalId) return

  const profesional = buscarProfesional(profesionalId)

  if (modulo.servicioId && modulo.servicioId !== profesional.servicioId) {
    errorDeNegocio(
      `${modulo.nombre} no pertenece a ${buscarServicio(profesional.servicioId).nombre}. Pide que te asignen tu consultorio.`,
    )
  }

  // Solo cuenta lo que esta pasando HOY.
  //
  // Un turno se queda en LLAMADO hasta que alguien lo cierra, y al final de la
  // jornada es normal que el ultimo quede abierto: el doctor termina y se va.
  // Sin acotarlo al dia, ese turno colgado de ayer dejaba el consultorio
  // bloqueado para cualquier otro doctor de manera permanente. Es el mismo
  // criterio que usa `estadoPantalla` para no arrastrar turnos viejos.
  const hoy = diaColombia(ahoraISO())
  const ocupadoPorOtro = estado.turnos.find(
    (t) =>
      t.moduloId === modulo.id &&
      (t.estado === 'LLAMADO' || t.estado === 'EN_ATENCION') &&
      t.horaLlamado &&
      diaColombia(t.horaLlamado) === hoy &&
      t.profesionalId &&
      t.profesionalId !== profesionalId,
  )
  if (ocupadoPorOtro) {
    const otro = estado.profesionales.find((p) => p.id === ocupadoPorOtro.profesionalId)
    errorDeNegocio(
      `${modulo.nombre} lo esta usando ${otro?.nombre ?? 'otro profesional'} en este momento (turno ${ocupadoPorOtro.codigo}).`,
    )
  }
}

/**
 * Siguiente codigo del servicio, EMPEZANDO DE NUEVO CADA DIA.
 *
 * El contador va por dia y por prefijo. Antes era solo por prefijo y no se
 * reiniciaba nunca: al tercer dia de operacion la sala de espera estaria
 * llamando el turno C-247, un numero que no le dice nada a nadie, y pasados
 * unos meses se sale de los tres digitos y descuadra la pantalla. En una sala
 * de espera el turno tiene que ser un numero corto y del dia.
 */
function siguienteCodigo(servicio: Servicio) {
  const clave = `${diaColombia(ahoraISO())}|${servicio.prefijo}`
  estado.contadores[clave] = (estado.contadores[clave] ?? 0) + 1
  return `${servicio.prefijo}-${String(estado.contadores[clave]).padStart(3, '0')}`
}

/**
 * Turnos en espera de una fila, en el orden en que hay que atenderlos.
 *
 * SOLO LOS DE HOY, por el mismo motivo que `estadoPantalla`. Un turno se queda
 * EN_ESPERA hasta que alguien lo llama, y al cerrar la jornada es normal que
 * queden pacientes sin llamar: el que no espero, el que se fue, o los que
 * quedaron en la fila cuando el doctor termino y se marcho. Sin este filtro
 * esos turnos seguian en la cola al dia siguiente y, como la cola se ordena por
 * hora de generacion, quedaban DE PRIMEROS: el doctor pulsaba "siguiente" a
 * primera hora y el sistema llamaba a un paciente de ayer, que no esta en la
 * sala, mientras los de hoy esperaban detras. Y el televisor lo anunciaba con
 * un codigo de ayer.
 *
 * Los turnos viejos no se borran: siguen en el historico con su estado real
 * (EN_ESPERA, nunca atendido), que es justo lo que hay que poder revisar.
 */
function pendientesOrdenados(filtro: { servicioId?: string; profesionalId?: string }): Turno[] {
  const hoy = diaColombia(ahoraISO())

  return estado.turnos
    .filter((t) => {
      if (t.estado !== 'EN_ESPERA') return false
      if (diaColombia(t.fechaGeneracion) !== hoy) return false
      if (filtro.profesionalId && t.profesionalId !== filtro.profesionalId) return false
      if (filtro.servicioId && t.servicioId !== filtro.servicioId) return false
      return true
    })
    .sort(ordenAtencion)
}

/**
 * Un turno solo se cierra si esta siendo atendido.
 *
 * Antes se cerraba cualquier turno, en cualquier estado. Eso permitia dos
 * cosas malas y silenciosas: dar por atendido a alguien que todavia estaba en
 * la fila sin haberlo llamado (desaparece de la cola y nadie se entera), y
 * volver a cerrar uno ya cerrado, que le reescribia la hora de atencion y
 * ensuciaba los tiempos promedio del informe. En una historia de atenciones
 * eso no puede pasar.
 */
function exigirTurnoEnAtencion(turno: Turno, accion: 'atendido' | 'ausente') {
  if (turno.estado === 'LLAMADO' || turno.estado === 'EN_ATENCION') return

  if (turno.estado === 'EN_ESPERA') {
    errorDeNegocio(`El turno ${turno.codigo} todavia no ha sido llamado.`)
  }
  errorDeNegocio(`El turno ${turno.codigo} ya esta cerrado; no se puede marcar como ${accion}.`)
}

/** Arma la casilla que ve la pantalla publica, con el nombre ya enmascarado. */
/**
 * El turno que ese profesional llamara despues, o null si no queda nadie.
 *
 * Mismo criterio que `llamarSiguiente` y que `estadoPantalla`, y el mismo que
 * la implementacion contra Postgres: el primero de su cola con los prioritarios
 * delante (`ordenAtencion`).
 */
function proximoDelProfesional(profesionalId: string | null | undefined): string | null {
  if (!profesionalId) return null

  const hoy = diaColombia(ahoraISO())
  const cola = estado.turnos
    .filter(
      (t) =>
        t.estado === 'EN_ESPERA' &&
        t.profesionalId === profesionalId &&
        diaColombia(t.fechaGeneracion) === hoy,
    )
    .sort(ordenAtencion)

  return cola[0]?.codigo ?? null
}

/**
 * Arma la casilla que ve la pantalla publica. NO lleva datos del paciente.
 *
 * LLEVA TAMBIEN EL PROXIMO, por el mismo motivo que la version contra Postgres:
 * esta casilla viaja por el canal en vivo en cada llamado y la pantalla
 * reemplaza con ella la que tenia, asi que si no lo trajera, cada llamado
 * borraria de la cartelera el aviso de "se estan preparando" de ese
 * consultorio hasta la siguiente resincronizacion.
 */
function casillaDeTurno(turno: Turno): CasillaPantalla {
  const modulo = buscarModulo(turno.moduloId!)
  const servicio = buscarServicio(turno.servicioId)
  const profesional = estado.profesionales.find((p) => p.id === turno.profesionalId)

  return {
    moduloId: modulo.id,
    moduloNombre: modulo.nombre,
    servicioId: servicio.id,
    servicioNombre: servicio.nombre,
    profesionalNombre: profesional?.nombre ?? null,
    codigo: turno.codigo,
    horaLlamado: turno.horaLlamado ?? null,
    vecesLlamado: turno.vecesLlamado,
    siguienteCodigo: proximoDelProfesional(turno.profesionalId),
  }
}

/**
 * Traduce el estado del TURNO (si existe) al estado que ve el doctor en su
 * agenda. Sin turno, la cita sigue PROGRAMADA: es la señal de "aun no ha
 * llegado", no un error.
 */
function estadoAgendaDe(turno: Turno | undefined): EstadoAgendaItem {
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
    case 'AUSENTE':
      return 'AUSENTE'
    case 'CANCELADO':
      // No deberia pasar (un turno cancelado no tiene flujo hoy), pero si
      // pasara, es mas honesto mostrarlo como ausente que como "programada".
      return 'AUSENTE'
    default:
      return 'PROGRAMADA'
  }
}

function itemAgenda(cita: Cita, turno: Turno | undefined): ItemAgendaProfesional {
  return {
    citaId: cita.id,
    turnoId: turno?.id ?? null,
    documentoPaciente: cita.documentoPaciente,
    nombrePaciente: cita.nombrePaciente,
    horaCita: cita.horaCita,
    estado: estadoAgendaDe(turno),
    codigo: turno?.codigo ?? null,
    vecesLlamado: turno?.vecesLlamado ?? 0,
    cierreAutomatico: turno?.cierreAutomatico ?? false,
  }
}

export class InMemoryTurnoRepository implements TurnoRepository {
  // --- Catalogos ---

  async listarServicios(incluirInactivos = false): Promise<Servicio[]> {
    return estado.servicios.filter((s) => incluirInactivos || s.activo)
  }

  async listarModulos(servicioId?: string, incluirInactivos = false): Promise<Modulo[]> {
    return estado.modulos.filter(
      (m) =>
        (incluirInactivos || m.activo) && (!servicioId || !m.servicioId || m.servicioId === servicioId),
    )
  }

  async listarProfesionales(servicioId?: string, incluirInactivos = false): Promise<Profesional[]> {
    return estado.profesionales.filter(
      (p) => (incluirInactivos || p.activo) && (!servicioId || p.servicioId === servicioId),
    )
  }

  async profesionalDeUsuario(usuarioId: string): Promise<Profesional | null> {
    return estado.profesionales.find((p) => p.activo && p.usuarioId === usuarioId) ?? null
  }

  // --- Agenda de citas ---
  //
  // TEMPORAL: en produccion las citas las trae la API del hospital. Estos
  // metodos existen para poder cargar citas a mano durante el demo y las
  // pruebas, mientras esa API no exista.

  async listarCitas(filtro: { fecha?: string; profesionalId?: string } = {}): Promise<Cita[]> {
    return estado.citas
      .filter((c) => {
        if (c.estado === 'CANCELADA') return false
        if (filtro.profesionalId && c.profesionalId !== filtro.profesionalId) return false
        if (filtro.fecha && diaColombia(c.horaCita) !== filtro.fecha) return false
        return true
      })
      .sort((a, b) => new Date(a.horaCita).getTime() - new Date(b.horaCita).getTime())
  }

  async crearCita(datos: {
    documentoPaciente: string
    nombrePaciente: string
    profesionalId: string
    horaCita: string
    /** Quien la agenda, para poder responder despues quien la creo. */
    usuarioId?: string
  }): Promise<Cita> {
    const profesional = estado.profesionales.find((p) => p.id === datos.profesionalId)
    if (!profesional) errorDeNegocio('El profesional indicado no existe.')
    if (!profesional.activo) errorDeNegocio('El profesional esta inactivo.')

    const documento = datos.documentoPaciente.trim()
    const nombre = datos.nombrePaciente.trim()
    if (!documento) errorDeNegocio('Ingresa el documento del paciente.')
    if (!nombre) errorDeNegocio('Ingresa el nombre del paciente.')
    if (Number.isNaN(new Date(datos.horaCita).getTime())) errorDeNegocio('La hora de la cita no es valida.')

    // Las mismas reglas que `reprogramarCita`, que es volver a agendar: si al
    // servicio se le cambio el modo de fila, aqui no se cuela una cita para un
    // servicio que atiende por orden de llegada.
    validarServicioDeProfesional(buscarServicio(profesional.servicioId))
    validarFranjaDeCita({ horaCita: datos.horaCita, profesional })

    const cita: Cita = {
      id: crearId(),
      documentoPaciente: documento,
      nombrePaciente: nombre,
      profesionalId: profesional.id,
      servicioId: profesional.servicioId,
      horaCita: datos.horaCita,
      estado: 'PROGRAMADA',
      creadaEn: ahoraISO(),
      creadaPor: datos.usuarioId ?? null,
      horaCitaOriginal: null,
      vecesReprogramada: 0,
    }

    estado.citas.push(cita)
    return cita
  }

  async cancelarCita(citaId: string, datos: { usuarioId?: string; motivo?: string } = {}): Promise<Cita> {
    const cita = estado.citas.find((c) => c.id === citaId)
    if (!cita) errorDeNegocio('La cita indicada no existe.')
    // Los motivos viven en `cita-transiciones` porque la implementacion contra
    // PostgreSQL tiene que dar exactamente los mismos avisos.
    const impedimento = motivoQueImpideCancelar(cita.estado)
    if (impedimento) errorDeNegocio(impedimento)

    cita.estado = 'CANCELADA'
    // Quien, cuando y por que. Antes cancelar dejaba el registro identico salvo
    // el estado: no habia forma de responder quien le cancelo la cita a un
    // paciente que viene a reclamar.
    cita.canceladaEn = ahoraISO()
    cita.canceladaPor = datos.usuarioId ?? null
    cita.motivoCancelacion = datos.motivo?.trim() || null

    return cita
  }

  /**
   * Mueve una cita de hora, y opcionalmente de doctor, CONSERVANDO LA CITA.
   *
   * No existia: mover a un paciente obligaba a cancelar y crear otra, y eso
   * dejaba dos registros sueltos sin nada que dijera que son el mismo paciente
   * movido. Asi no se puede responder "¿cuantas veces le han cambiado la cita?",
   * que es exactamente lo que se pregunta cuando alguien reclama.
   *
   * La hora nueva pasa por las mismas tres reglas que una cita nueva (franja
   * valida, jornada del doctor, cupo libre), porque reprogramar no es una
   * excepcion al horario: es volver a agendar.
   */
  async reprogramarCita(
    citaId: string,
    datos: { horaCita: string; profesionalId?: string; motivo?: string; usuarioId?: string },
  ): Promise<Cita> {
    const cita = estado.citas.find((c) => c.id === citaId)
    if (!cita) errorDeNegocio('La cita indicada no existe.')
    const impedimento = motivoQueImpideReprogramar(cita.estado)
    if (impedimento) errorDeNegocio(impedimento)

    const profesional = buscarProfesional(datos.profesionalId ?? cita.profesionalId)
    if (!profesional.activo) errorDeNegocio('El profesional esta inactivo.')
    validarServicioDeProfesional(buscarServicio(profesional.servicioId))

    validarFranjaDeCita({
      horaCita: datos.horaCita,
      profesional,
      // La propia cita no se cuenta como ocupante de su cupo: mover a alguien a
      // la hora que ya tiene no puede fallar por chocar consigo mismo.
      ignorarCitaId: cita.id,
    })

    // La ORIGINAL es la primera de todas, no la anterior: lo que hay que poder
    // reconstruir es a que hora se le dijo al paciente que viniera la primera
    // vez, por muchas veces que se le haya movido despues.
    cita.horaCitaOriginal ??= cita.horaCita

    cita.horaCita = datos.horaCita
    cita.profesionalId = profesional.id
    cita.servicioId = profesional.servicioId
    cita.vecesReprogramada = (cita.vecesReprogramada ?? 0) + 1
    cita.reprogramadaEn = ahoraISO()
    cita.reprogramadaPor = datos.usuarioId ?? null
    cita.motivoReprogramacion = datos.motivo?.trim() || null

    return cita
  }

  /**
   * El horario del dia, listo para pintar.
   *
   * Se recorren las citas UNA vez y se van colocando en su celda; lo que no
   * cae en ninguna celda queda en `fueraDeHorario` en vez de perderse. Ese
   * caso no es raro: pasa cada vez que se cambia la duracion de la consulta,
   * se mueve el horario de una jornada o se le cambia la jornada a un doctor
   * que ya tenia pacientes agendados.
   */
  async horarioDelDia(fecha: string): Promise<HorarioDia> {
    const configuracion = estado.configuracion
    const { duracionCitaMinutos } = configuracion

    const citasDelDia = estado.citas.filter(
      (c) => c.estado !== 'CANCELADA' && diaColombia(c.horaCita) === fecha,
    )

    const enHorario = (cita: Cita): CitaEnHorario => ({
      id: cita.id,
      documentoPaciente: cita.documentoPaciente,
      nombrePaciente: cita.nombrePaciente,
      profesionalId: cita.profesionalId,
      hora: horaColombia(cita.horaCita),
      horaCita: cita.horaCita,
      estado: cita.estado,
      vecesReprogramada: cita.vecesReprogramada ?? 0,
      horaCitaOriginal: cita.horaCitaOriginal ?? null,
    })

    // Las que van quedando colocadas, para saber al final cuales sobraron.
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

      // Solo doctores activos de servicios que atienden por cita, ordenados
      // por servicio y nombre para que la parrilla se lea siempre igual y no
      // baile cuando se agrega un doctor nuevo.
      const doctores = estado.profesionales
        .filter(
          (p) => p.activo && (atiendeEnJornada(p, jornada) || bloquesConCitas.get(p.id)?.has(jornada) === true),
        )
        .filter((p) => estado.servicios.find((s) => s.id === p.servicioId)?.modoFila === 'POR_PROFESIONAL')
        .sort((a, b) => {
          const servicioA = estado.servicios.find((s) => s.id === a.servicioId)?.nombre ?? ''
          const servicioB = estado.servicios.find((s) => s.id === b.servicioId)?.nombre ?? ''
          return servicioA.localeCompare(servicioB, 'es') || a.nombre.localeCompare(b.nombre, 'es')
        })

      // Set y no `doctores.some(...)`: aquello recorria la lista de doctores
      // entera por cada cita del dia. Con treinta doctores y varios cientos de
      // citas eso son miles de comparaciones para armar una parrilla.
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
        servicioNombre: estado.servicios.find((s) => s.id === doctor.servicioId)?.nombre ?? '—',
        moduloNombre: estado.modulos.find((m) => m.id === doctor.moduloId)?.nombre ?? null,
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
    const citas = estado.citas.filter(
      (c) => c.estado !== 'CANCELADA' && diaColombia(c.horaCita) === fecha,
    )

    return jornadasSegunCitas(
      citas.map((c) => ({ profesionalId: c.profesionalId, hora: horaColombia(c.horaCita) })),
      estado.configuracion,
    )
  }

  /** Ver `actividadDelCatalogo` en el contrato del repositorio. */
  async actividadDelCatalogo(fecha: string): Promise<ActividadCatalogo> {
    const citas = estado.citas.filter(
      (c) => c.estado !== 'CANCELADA' && diaColombia(c.horaCita) === fecha,
    )

    // El consultorio sale del doctor, no de la cita: la cita guarda a quien
    // atiende, y el consultorio es donde ese doctor esta puesto.
    const moduloDelProfesional = new Map(estado.profesionales.map((p) => [p.id, p.moduloId ?? null]))

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
   * TEMPORAL (solo pruebas): deja el dia en blanco (sin turnos) sin tocar los
   * catalogos ni la configuracion, y vuelve a sembrar las citas de ejemplo.
   * Lo usa el panel de simulacion de carga.
   */
  async reiniciarDatosDeHoy(): Promise<void> {
    const hoy = diaColombia(ahoraISO())

    const citasDeOtrosDias = estado.citas.filter((c) => diaColombia(c.horaCita) !== hoy)
    const turnosDeOtrosDias = estado.turnos.filter((t) => diaColombia(t.fechaGeneracion) !== hoy)
    // Con la configuracion ACTUAL, no con la inicial: si el administrador
    // cambio la duracion de la consulta, las citas de ejemplo tienen que caer
    // en las franjas que existen ahora.
    const citasDeEjemplo = sembrarCitas(estado.profesionales, estado.configuracion)

    estado.citas.splice(0, estado.citas.length, ...citasDeOtrosDias, ...citasDeEjemplo)
    estado.turnos.splice(0, estado.turnos.length, ...turnosDeOtrosDias)
    // Los codigos vuelven a empezar en 001, como en un dia nuevo.
    estado.contadores = {}
  }

  // --- Admisiones ---

  /**
   * Citas de UN DIA de un paciente (por defecto hoy), para registrar su
   * llegada.
   *
   * Antes devolvia las citas de cualquier fecha. Como admisiones las muestra
   * solo con la hora ("09:00"), una cita de la semana entrante se veia igual
   * que una de hoy y se le podia registrar la llegada: el paciente entraba a
   * la fila de un dia que no era el suyo, ocupaba un turno real y le quemaba
   * la cita. Acotarlo al dia es lo que hace que lo que se ve en la pantalla
   * sea lo que de verdad se puede atender.
   */
  async buscarCitasPorDocumento(documento: string, fecha?: string): Promise<Cita[]> {
    const buscado = documento.trim()
    if (!buscado) return []

    const dia = fecha ?? diaColombia(ahoraISO())
    return estado.citas
      .filter(
        (c) =>
          c.documentoPaciente === buscado &&
          c.estado !== 'CANCELADA' &&
          diaColombia(c.horaCita) === dia,
      )
      .sort((a, b) => new Date(a.horaCita).getTime() - new Date(b.horaCita).getTime())
  }

  /**
   * Citas del paciente en OTROS dias, solo para informar.
   *
   * Sin esto, el paciente que se equivoca de dia recibe un "sin citas para ese
   * documento" y la pantalla le sugiere al funcionario mandarlo a la fila de
   * ventanilla, que es peor que no responder nada. Con esto se le puede decir
   * "su cita es el jueves a las 9"; no traen boton, porque no son de hoy.
   */
  async otrasCitasDelPaciente(documento: string, fecha?: string): Promise<Cita[]> {
    const buscado = documento.trim()
    if (!buscado) return []

    const dia = fecha ?? diaColombia(ahoraISO())
    return estado.citas
      .filter(
        (c) =>
          c.documentoPaciente === buscado &&
          c.estado === 'PROGRAMADA' &&
          // Solo las que ESTAN POR VENIR. Una cita pasada que se quedo en
          // PROGRAMADA es una inasistencia vieja: decirle al paciente "su cita
          // es el martes" cuando ese martes ya paso lo manda a esperar un dia
          // que no existe.
          diaColombia(c.horaCita) > dia,
      )
      .sort((a, b) => new Date(a.horaCita).getTime() - new Date(b.horaCita).getTime())
  }

  async registrarLlegada(citaId: string): Promise<Turno> {
    const cita = estado.citas.find((c) => c.id === citaId)
    if (!cita) errorDeNegocio('La cita indicada no existe.')
    if (cita.estado === 'CANCELADA') errorDeNegocio('La cita fue cancelada.')
    if (cita.estado !== 'PROGRAMADA') errorDeNegocio('Esta cita ya registro la llegada del paciente.')

    // Ultima defensa: aunque la busqueda ya solo ofrezca las citas de hoy, el
    // id llega en el cuerpo de la peticion. Una llegada registrada contra una
    // cita de otro dia mete al paciente en la fila equivocada y deja el turno
    // contado en el dia que no es.
    const hoy = diaColombia(ahoraISO())
    const diaDeLaCita = diaColombia(cita.horaCita)
    if (diaDeLaCita !== hoy) {
      errorDeNegocio(
        `Esta cita no es de hoy, es del ${diaDeLaCita}. Solo se puede registrar la llegada el mismo dia de la cita.`,
      )
    }

    // Ultima defensa, igual que la del dia: el doctor de la cita tiene que
    // seguir activo. Si lo dieron de baja, su enlace de consultorio ya no sirve
    // y no puede llamar a nadie: meter a este paciente en su fila seria dejarlo
    // esperando un llamado que no va a llegar nunca, sin que ninguna pantalla lo
    // advierta. Es mejor que admisiones se entere ahora, con el paciente
    // delante, y le resuelva la cita.
    if (cita.profesionalId) {
      const profesional = estado.profesionales.find((p) => p.id === cita.profesionalId)
      if (!profesional?.activo) {
        errorDeNegocio(
          'El profesional de esta cita ya no esta activo, asi que no podria llamar al paciente. Reasignale la cita a otro profesional.',
        )
      }
    }

    const servicio = buscarServicio(cita.servicioId)
    cita.estado = 'PRESENTADO'

    const turno: Turno = {
      id: crearId(),
      codigo: siguienteCodigo(servicio),
      servicioId: servicio.id,
      estado: 'EN_ESPERA',
      prioridad: 'NORMAL',
      fechaGeneracion: ahoraISO(),
      horaLlamado: null,
      horaAtencion: null,
      moduloId: null,
      funcionarioId: null,
      vecesLlamado: 0,
      citaId: cita.id,
      profesionalId: cita.profesionalId,
      nombrePaciente: cita.nombrePaciente,
      horaCita: cita.horaCita,
    }

    estado.turnos.push(turno)
    return turno
  }

  async comprobanteDeLlegada(turnoId: string): Promise<ComprobanteLlegada> {
    const turno = buscarTurno(turnoId)
    const servicio = buscarServicio(turno.servicioId)
    const profesional = estado.profesionales.find((p) => p.id === turno.profesionalId)

    // El consultorio sale del turno si ya lo llamaron; si todavia esta en
    // espera, del consultorio habitual del doctor, que es el dato con el que
    // se puede orientar al paciente en ese momento. Si el doctor se mueve de
    // consultorio ese dia, manda lo que muestre la pantalla al llamarlo.
    const moduloId = turno.moduloId ?? profesional?.moduloId ?? null
    const modulo = moduloId ? estado.modulos.find((m) => m.id === moduloId) : null

    return {
      turnoId: turno.id,
      codigo: turno.codigo,
      servicioNombre: servicio.nombre,
      profesionalNombre: profesional?.nombre ?? null,
      moduloNombre: modulo?.nombre ?? null,
      horaCita: turno.horaCita ?? null,
      nombrePaciente: turno.nombrePaciente ?? null,
    }
  }

  async generarTurnoDeVentanilla(servicioId: string): Promise<Turno> {
    const servicio = buscarServicio(servicioId)
    if (servicio.modoFila !== 'COMPARTIDA') {
      errorDeNegocio('Este servicio atiende por cita: el turno se genera al registrar la llegada del paciente.')
    }

    const turno: Turno = {
      id: crearId(),
      codigo: siguienteCodigo(servicio),
      servicioId: servicio.id,
      estado: 'EN_ESPERA',
      prioridad: 'NORMAL',
      fechaGeneracion: ahoraISO(),
      horaLlamado: null,
      horaAtencion: null,
      moduloId: null,
      funcionarioId: null,
      vecesLlamado: 0,
      citaId: null,
      profesionalId: null,
      nombrePaciente: null,
    }

    estado.turnos.push(turno)
    return turno
  }

  /**
   * Agenda del dia de un profesional (trazabilidad de punta a punta: seccion
   * "flujo del turno"). Parte de las CITAS (no de los turnos) para que una
   * cita que aun no genero turno (el paciente no ha llegado) siga siendo
   * visible para el doctor, en vez de desaparecer.
   */
  async agendaProfesional(profesionalId: string, fecha: string): Promise<ItemAgendaProfesional[]> {
    buscarProfesional(profesionalId)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) errorDeNegocio('La fecha no es valida.')

    return estado.citas
      .filter(
        (c) => c.profesionalId === profesionalId && c.estado !== 'CANCELADA' && diaColombia(c.horaCita) === fecha,
      )
      .map((cita) => itemAgenda(cita, estado.turnos.find((t) => t.citaId === cita.id)))
      .sort((a, b) => new Date(a.horaCita).getTime() - new Date(b.horaCita).getTime())
  }

  // --- Operacion ---

  async listarPendientes(filtro: { servicioId?: string; profesionalId?: string }): Promise<Turno[]> {
    return pendientesOrdenados(filtro)
  }

  /**
   * Si ese turno es de ese profesional. Es la comprobacion que impide que un
   * doctor cierre el turno de otro cambiando el id en la URL.
   *
   * Antes esto se resolvia pidiendo el historico COMPLETO del profesional
   * (filtrar y ordenar todos los turnos que existen) para acabar mirando uno
   * solo. Se hace en cada "atendido", "ausente" y "repetir" de cada doctor, y
   * el coste crecia con cada turno del historial: al mes de operacion, cada
   * clic del medico recorria decenas de miles de registros.
   */
  async turnoEsDelProfesional(turnoId: string, profesionalId: string): Promise<boolean> {
    const turno = estado.turnos.find((t) => t.id === turnoId)
    return Boolean(turno && turno.profesionalId === profesionalId)
  }

  /**
   * El paciente que el profesional tiene AHORA al frente, o null.
   *
   * No vive como tal en el repositorio: es el ultimo turno LLAMADO o
   * EN_ATENCION suyo del dia. Se resuelve en UNA pasada, sin construir ni
   * ordenar el historico entero: la pantalla del doctor se refresca sola cada
   * pocos segundos y con varios consultorios abiertos esa consulta es de las
   * mas repetidas del sistema.
   */
  async turnoEnAtencion(profesionalId: string, fecha: string): Promise<Turno | null> {
    let actual: Turno | null = null

    for (const turno of estado.turnos) {
      if (turno.profesionalId !== profesionalId) continue
      if (turno.estado !== 'LLAMADO' && turno.estado !== 'EN_ATENCION') continue
      if (diaColombia(turno.fechaGeneracion) !== fecha) continue

      // Si hubiera mas de uno abierto, manda el ultimo que se llamo.
      if (!actual || new Date(turno.horaLlamado ?? 0) > new Date(actual.horaLlamado ?? 0)) {
        actual = turno
      }
    }

    return actual
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

    const modulo = buscarModulo(params.moduloId)
    validarModuloParaLlamar(modulo, params.profesionalId)

    // La fila se lee y se marca SIN ceder el control en medio (nada de
    // `await` aqui). Con un `await` entre leer la fila y marcar el turno, dos
    // peticiones que llegan casi juntas leen la misma fila y las dos se
    // llevan al mismo paciente: dos consultorios llamando a la misma persona.
    // Pasa de verdad cuando varios doctores pulsan "siguiente" a la vez.
    const siguiente = pendientesOrdenados({
      servicioId: params.servicioId,
      profesionalId: params.profesionalId,
    })[0]
    if (!siguiente) return null

    // Un consultorio atiende a un paciente a la vez: al llamar el siguiente, el
    // anterior de ese mismo modulo se da por atendido.
    cerrarAtencionAbierta(modulo.id, siguiente.id, params.profesionalId)

    const instante = ahoraISO()

    siguiente.estado = 'LLAMADO'
    siguiente.moduloId = modulo.id
    siguiente.funcionarioId = params.funcionarioId
    siguiente.horaLlamado = instante
    // El primero se graba una sola vez y ya no se toca: es contra el que se
    // mide la espera del paciente (ver `horaPrimerLlamado` en `types.ts`).
    siguiente.horaPrimerLlamado ??= instante
    siguiente.vecesLlamado += 1

    realtimeHub.publish({ tipo: 'turno.llamado', casilla: casillaDeTurno(siguiente), repetido: false })

    return siguiente
  }

  async repetirLlamado(turnoId: string): Promise<Turno> {
    const turno = buscarTurno(turnoId)
    if (!turno.moduloId) errorDeNegocio('El turno no ha sido llamado todavia.')

    // Solo se repite el turno que se esta atendiendo AHORA. Repetir uno ya
    // cerrado volvia a publicarlo en la pantalla: el consultorio mostraria a
    // un paciente que ya se fue, tapando al que de verdad esta adentro.
    if (turno.estado !== 'LLAMADO' && turno.estado !== 'EN_ATENCION') {
      errorDeNegocio('Ese turno ya se cerro; no se puede volver a llamar.')
    }

    turno.vecesLlamado += 1
    // Se actualiza el ULTIMO llamado (la pantalla ordena por el), nunca el
    // primero: repetir el llamado no puede reescribir cuanto espero el
    // paciente.
    turno.horaLlamado = ahoraISO()
    turno.horaPrimerLlamado ??= turno.horaLlamado

    realtimeHub.publish({ tipo: 'turno.llamado', casilla: casillaDeTurno(turno), repetido: true })

    return turno
  }

  async marcarAtendido(turnoId: string, cerradoPor?: string): Promise<Turno> {
    const turno = buscarTurno(turnoId)
    exigirTurnoEnAtencion(turno, 'atendido')

    const instante = ahoraISO()
    turno.estado = 'ATENDIDO'
    turno.horaAtencion = instante
    turno.cerradoEn = instante
    turno.cerradoPor = cerradoPor ?? null
    turno.cierreAutomatico = false

    if (turno.citaId) {
      const cita = estado.citas.find((c) => c.id === turno.citaId)
      if (cita) cita.estado = 'ATENDIDA'
    }

    if (turno.moduloId) realtimeHub.publish({ tipo: 'modulo.liberado', moduloId: turno.moduloId })
    return turno
  }

  async marcarAusente(turnoId: string, cerradoPor?: string): Promise<Turno> {
    const turno = buscarTurno(turnoId)
    exigirTurnoEnAtencion(turno, 'ausente')

    turno.estado = 'AUSENTE'
    // El ausente tambien deja hora. Antes solo cambiaba el estado, asi que no
    // se sabia cuando se le habia dado por ausente ni cuanto se le espero, y
    // ante un reclamo del paciente no habia nada que mirar. `horaAtencion` se
    // deja en null a proposito: a este paciente no se le atendio.
    turno.cerradoEn = ahoraISO()
    turno.cerradoPor = cerradoPor ?? null
    turno.cierreAutomatico = false

    if (turno.moduloId) realtimeHub.publish({ tipo: 'modulo.liberado', moduloId: turno.moduloId })
    return turno
  }

  // --- Pantalla de la sala de espera ---

  async estadoPantalla(): Promise<EstadoPantalla> {
    // SOLO turnos llamados HOY.
    //
    // Un turno queda en LLAMADO hasta que el doctor lo cierra, y al final de
    // la jornada es normal que el ultimo se quede sin cerrar: el doctor
    // termina y se va. Sin este filtro, ese turno seguia pintado en el
    // televisor a la mañana siguiente, y el primer paciente del dia veia un
    // numero que ya paso y creia que le tocaba.
    const hoy = diaColombia(ahoraISO())

    // UNA sola pasada por los turnos, quedandose con el ultimo llamado de cada
    // consultorio. Antes se recorria la lista completa de turnos una vez POR
    // CONSULTORIO, y ademas se ordenaba: con diez consultorios y el historial
    // de unos meses, pintar la pantalla costaba diez recorridos y diez
    // ordenaciones de todo. Esta ruta la piden el televisor y el monitor del
    // administrador cada pocos segundos.
    const ultimoPorModulo = new Map<string, Turno>()
    for (const turno of estado.turnos) {
      if (!turno.moduloId || !turno.horaLlamado) continue
      if (turno.estado !== 'LLAMADO' && turno.estado !== 'EN_ATENCION') continue
      if (diaColombia(turno.horaLlamado) !== hoy) continue

      const actual = ultimoPorModulo.get(turno.moduloId)
      if (!actual || new Date(turno.horaLlamado) > new Date(actual.horaLlamado!)) {
        ultimoPorModulo.set(turno.moduloId, turno)
      }
    }

    // QUE CONSULTORIOS SE VEN. El criterio vive en `./casillas`, puro y
    // compartido con la implementacion contra Postgres: las dos cumplen el
    // mismo contrato y tienen que mostrar lo mismo. Estuvo escrito solo en la
    // otra, y esta se quedo enseñando una casilla por modulo activo; la prueba
    // corria contra esta, asi que daba por bueno lo contrario de lo que hacia
    // el hospital de verdad.
    const modulosActivos = estado.modulos.filter((m) => m.activo)
    const citasDeHoy = estado.citas.filter(
      (c) => c.estado !== 'CANCELADA' && diaColombia(c.horaCita) === hoy,
    )
    // Las CANCELADAS tambien cuentan para saber si la agenda del dia se subio:
    // ver la nota de `hayAgendaDelDia` en `./casillas`.
    const citasRegistradasHoy = estado.citas.filter((c) => diaColombia(c.horaCita) === hoy).length
    const moduloDelProfesional = new Map(estado.profesionales.map((p) => [p.id, p.moduloId ?? null]))
    const profesionalesConCita = new Set(citasDeHoy.map((c) => c.profesionalId))

    const visibles = modulosVisiblesEnPantalla({
      modulos: modulosActivos.map((m) => ({ id: m.id, servicioId: m.servicioId ?? null })),
      serviciosDeVentanilla: new Set(
        estado.servicios.filter((s) => s.modoFila === 'COMPARTIDA').map((s) => s.id),
      ),
      conCitasHoy: new Set(
        [...profesionalesConCita].map((id) => moduloDelProfesional.get(id)).filter(Boolean) as string[],
      ),
      conTurnosHoy: new Set(
        estado.turnos
          .filter((t) => t.moduloId && diaColombia(t.fechaGeneracion) === hoy)
          .map((t) => t.moduloId!),
      ),
      conProfesionalAsignado: new Set(
        estado.profesionales.filter((p) => p.activo && p.moduloId).map((p) => p.moduloId!) as string[],
      ),
      hayAgendaDelDia: citasRegistradasHoy > 0,
    })

    /*
     * EL PROXIMO DE CADA DOCTOR, para poder decir quien entra despues.
     *
     * Mismo criterio que la implementacion contra Postgres y que
     * `llamarSiguiente`: el primero de la cola de ESE profesional, con los
     * prioritarios delante (`ordenAtencion`). Si las dos implementaciones
     * ordenaran distinto, las pruebas darian por bueno un orden que el
     * hospital no usa.
     */
    const proximoPorProfesional = new Map<string, Turno>()
    for (const turno of estado.turnos) {
      if (turno.estado !== 'EN_ESPERA' || !turno.profesionalId) continue
      if (diaColombia(turno.fechaGeneracion) !== hoy) continue

      const actual = proximoPorProfesional.get(turno.profesionalId)
      if (!actual || ordenAtencion(turno, actual) < 0) {
        proximoPorProfesional.set(turno.profesionalId, turno)
      }
    }

    /*
     * Quien entra despues en esta casilla, o null si no se puede prometer.
     *
     * En una ventanilla de fila compartida no hay doctor y la cola es de
     * todos: ese turno se lo lleva la ventanilla que pulse antes, asi que
     * anunciarlo aqui mandaria al paciente a la ventanilla equivocada (ver
     * `siguienteCodigo` en `types.ts`).
     */
    const proximoDeLaCasilla = (moduloId: string) => {
      const doctor = profesionalDeTurnoEn(
        moduloId,
        citasRegistradasHoy > 0 ? profesionalesConCita : undefined,
      )
      if (!doctor) return null
      return proximoPorProfesional.get(doctor.id)?.codigo ?? null
    }

    const casillas = modulosActivos
      .filter((m) => visibles.has(m.id))
      .map((modulo) => {
        const turno = ultimoPorModulo.get(modulo.id)

        if (turno) return { ...casillaDeTurno(turno), siguienteCodigo: proximoDeLaCasilla(modulo.id) }

        const servicio = modulo.servicioId ? buscarServicio(modulo.servicioId) : null
        // Solo profesionales ACTIVOS: si un doctor se dio de baja y su ficha
        // quedo apuntando al consultorio, su nombre seguia saliendo en la
        // pantalla de la sala de espera como si estuviera atendiendo.
        //
        // Y de los activos, EL DE LA JORNADA QUE CORRE AHORA. Lo normal es que
        // un consultorio lo compartan dos doctores, uno de mañana y otro de
        // tarde; se cogia el primero de la lista, asi que el televisor mostraba
        // al de la mañana toda la tarde y el paciente entraba preguntando por un
        // doctor que ya se habia ido.
        // El dia sin agenda cargada es la excepcion: ahi nadie tiene citas, y
        // recortar por ellas dejaria todas las puertas sin nombre.
        const profesional = profesionalDeTurnoEn(
          modulo.id,
          citasRegistradasHoy > 0 ? profesionalesConCita : undefined,
        )

        return {
          moduloId: modulo.id,
          moduloNombre: modulo.nombre,
          servicioId: servicio?.id ?? '',
          servicioNombre: servicio?.nombre ?? 'Ventanilla',
          profesionalNombre: profesional?.nombre ?? null,
          codigo: null,
          horaLlamado: null,
          vecesLlamado: 0,
          siguienteCodigo: proximoDeLaCasilla(modulo.id),
        }
      })

    return { casillas, configuracion: { ...estado.configuracion } }
  }

  // --- Historico y estadisticas ---

  async historico(filtro: FiltroHistorico): Promise<Turno[]> {
    return estado.turnos
      .filter((t) => {
        if (filtro.servicioId && t.servicioId !== filtro.servicioId) return false
        if (filtro.codigo && !t.codigo.toUpperCase().includes(filtro.codigo.toUpperCase())) return false
        if (filtro.estado && t.estado !== filtro.estado) return false
        if (filtro.moduloId && t.moduloId !== filtro.moduloId) return false
        if (filtro.funcionarioId && t.funcionarioId !== filtro.funcionarioId) return false
        if (filtro.profesionalId && t.profesionalId !== filtro.profesionalId) return false
        if (filtro.fecha && diaColombia(t.fechaGeneracion) !== filtro.fecha) return false
        if (filtro.fechaDesde && diaColombia(t.fechaGeneracion) < filtro.fechaDesde) return false
        if (filtro.fechaHasta && diaColombia(t.fechaGeneracion) > filtro.fechaHasta) return false
        return true
      })
      .sort((a, b) => new Date(b.fechaGeneracion).getTime() - new Date(a.fechaGeneracion).getTime())
  }

  async estadisticas(fecha: string): Promise<EstadisticasDia> {
    const delDia = estado.turnos.filter((t) => diaColombia(t.fechaGeneracion) === fecha)
    // Las citas del dia entran en el calculo para poder medir la inasistencia,
    // que no se ve en los turnos: el que no viene no genera turno.
    const citasDelDia = estado.citas.filter((c) => diaColombia(c.horaCita) === fecha)

    const porFuncionario = new Map<string, number>()
    for (const turno of delDia) {
      // Se cuenta a quien CERRO la atencion, no a quien llamo, y solo si la
      // cerro alguien: los cierres automaticos no se le apuntan a nadie.
      const responsable = turno.cerradoPor ?? turno.funcionarioId
      if (turno.estado !== 'ATENDIDO' || turno.cierreAutomatico || !responsable) continue
      porFuncionario.set(responsable, (porFuncionario.get(responsable) ?? 0) + 1)
    }

    return {
      fecha,
      total: resumir('', 'Todos los servicios', delDia, citasDelDia),
      porServicio: estado.servicios.map((servicio) =>
        resumir(
          servicio.id,
          servicio.nombre,
          delDia.filter((t) => t.servicioId === servicio.id),
          citasDelDia.filter((c) => c.servicioId === servicio.id),
        ),
      ),
      porFuncionario: [...porFuncionario.entries()]
        .map(([funcionarioId, atendidos]) => ({ funcionarioId, atendidos }))
        .sort((a, b) => b.atendidos - a.atendidos),
    }
  }

  // --- Administracion de catalogos ---

  async crearServicio(datos: Omit<Servicio, 'id'>): Promise<Servicio> {
    validarPrefijoLibre(datos.prefijo)
    validarNombreDeServicioLibre(datos.nombre)
    // El nombre se guarda ya recortado, igual que en la implementacion contra
    // Postgres: si una guarda " Odontologia " y la otra "Odontologia", las dos
    // dejan de cumplir el mismo contrato.
    const servicio: Servicio = {
      ...datos,
      nombre: datos.nombre.trim(),
      prefijo: datos.prefijo.toUpperCase(),
      id: `srv-${crearId()}`,
    }
    estado.servicios.push(servicio)
    return servicio
  }

  async actualizarServicio(id: string, datos: Partial<Omit<Servicio, 'id'>>): Promise<Servicio> {
    const servicio = buscarServicio(id)
    if (datos.prefijo && datos.prefijo.toUpperCase() !== servicio.prefijo) {
      validarPrefijoLibre(datos.prefijo)
      // El contador va por prefijo: al cambiarlo, la numeracion arranca donde
      // iba ese prefijo nuevo, no donde iba el anterior.
      servicio.prefijo = datos.prefijo.toUpperCase()
    }
    if (datos.nombre !== undefined) {
      validarNombreDeServicioLibre(datos.nombre, id)
      servicio.nombre = datos.nombre.trim()
    }
    if (datos.modoFila !== undefined && datos.modoFila !== servicio.modoFila) {
      validarCambioDeModoFila(servicio, datos.modoFila)
      servicio.modoFila = datos.modoFila
    }
    if (datos.activo !== undefined) servicio.activo = datos.activo
    return servicio
  }

  async eliminarServicio(id: string): Promise<void> {
    const servicio = buscarServicio(id)

    // Un servicio que ya opero no se borra: el historico y las estadisticas
    // buscan el servicio de cada turno por su id y quedarian rotos. Para
    // sacarlo de circulacion esta el interruptor de activo/inactivo, que ya lo
    // esconde de las filas y de la pantalla sin perder el rastro.
    const conTurnos = estado.turnos.some((t) => t.servicioId === id)
    if (conTurnos) {
      errorDeNegocio(
        `${servicio.nombre} ya tiene turnos registrados, asi que no se puede eliminar. Desactivalo para dejar de usarlo sin perder el historico.`,
      )
    }

    const conCitas = estado.citas.some((c) => c.servicioId === id && c.estado !== 'CANCELADA')
    if (conCitas) {
      errorDeNegocio(`${servicio.nombre} tiene citas agendadas. Cancelalas o desactiva el servicio.`)
    }

    const profesionales = estado.profesionales.filter((p) => p.servicioId === id)
    if (profesionales.length > 0) {
      errorDeNegocio(
        `${servicio.nombre} tiene ${profesionales.length} profesional(es) asignado(s). Muevelos a otro servicio antes de eliminarlo.`,
      )
    }

    // Los modulos si se conservan: un consultorio o una ventanilla sigue
    // existiendo aunque el servicio deje de existir, solo queda sin asignar.
    for (const modulo of estado.modulos) {
      if (modulo.servicioId === id) modulo.servicioId = null
    }

    estado.servicios.splice(estado.servicios.indexOf(servicio), 1)
    // El contador va por dia y prefijo: se limpian todos los dias de ese
    // prefijo, para que si vuelve a usarse en un servicio nuevo la numeracion
    // arranque en 001 como corresponde.
    for (const clave of Object.keys(estado.contadores)) {
      if (clave.endsWith(`|${servicio.prefijo}`)) delete estado.contadores[clave]
    }
  }

  async crearModulo(datos: Omit<Modulo, 'id'>): Promise<Modulo> {
    if (datos.servicioId) buscarServicio(datos.servicioId)

    const nombre = datos.nombre.trim()
    validarNombreDeModuloLibre(nombre)

    const modulo: Modulo = { ...datos, nombre, id: `mod-${crearId()}` }
    estado.modulos.push(modulo)
    return modulo
  }

  async actualizarModulo(id: string, datos: Partial<Omit<Modulo, 'id'>>): Promise<Modulo> {
    const modulo = buscarModulo(id)
    if (datos.servicioId) buscarServicio(datos.servicioId)

    if (datos.nombre !== undefined) {
      const nombre = datos.nombre.trim()
      validarNombreDeModuloLibre(nombre, modulo.id)
      modulo.nombre = nombre
    }

    if (datos.servicioId !== undefined) modulo.servicioId = datos.servicioId || null
    if (datos.activo !== undefined) {
      // Ver la nota de `validarModuloSinPacienteDentro` en la implementacion
      // contra Postgres: apagarlo con un turno abierto borra del televisor la
      // casilla donde el paciente acaba de ver su numero, y le bloquea al
      // doctor el llamado desde ahi.
      if (datos.activo === false) {
        const hoy = diaColombia(ahoraISO())
        const abierto = estado.turnos.find(
          (t) =>
            t.moduloId === id &&
            diaColombia(t.fechaGeneracion) === hoy &&
            (t.estado === 'LLAMADO' || t.estado === 'EN_ATENCION'),
        )
        if (abierto) {
          errorDeNegocio(
            `No se puede desactivar: el turno ${abierto.codigo} esta siendo atendido ahi. Espera a que el doctor lo cierre.`,
          )
        }
      }
      modulo.activo = datos.activo
    }
    return modulo
  }

  async crearProfesional(datos: {
    nombre: string
    servicioId: string
    jornada: Jornada
    moduloId?: string | null
  }): Promise<Profesional> {
    const nombre = datos.nombre.trim()
    if (!nombre) errorDeNegocio('Ingresa el nombre del profesional.')

    validarNombreDeProfesionalLibre(nombre)

    const servicio = buscarServicio(datos.servicioId)
    validarServicioDeProfesional(servicio)
    if (datos.moduloId) buscarModulo(datos.moduloId)

    const profesional: Profesional = {
      id: `pro-${crearId()}`,
      nombre,
      servicioId: servicio.id,
      jornada: datos.jornada,
      moduloId: datos.moduloId || null,
      activo: true,
    }

    estado.profesionales.push(profesional)
    return profesional
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
    const profesional = buscarProfesional(id)

    if (datos.nombre !== undefined) {
      const nombre = datos.nombre.trim()
      if (!nombre) errorDeNegocio('Ingresa el nombre del profesional.')
      validarNombreDeProfesionalLibre(nombre, id)
      profesional.nombre = nombre
    }

    if (datos.servicioId !== undefined && datos.servicioId !== profesional.servicioId) {
      const servicio = buscarServicio(datos.servicioId)
      validarServicioDeProfesional(servicio)

      // Las citas ya agendadas guardan el servicio: cambiarselo aqui las
      // dejaria apuntando al servicio anterior. Es mas honesto pedir que se
      // resuelva la agenda primero que mover al doctor y dejar el dia torcido.
      const conCitas = estado.citas.some(
        (c) => c.profesionalId === profesional.id && c.estado === 'PROGRAMADA',
      )
      if (conCitas) {
        errorDeNegocio(
          `${profesional.nombre} tiene citas programadas en ${buscarServicio(profesional.servicioId).nombre}. Atiendelas o cancelalas antes de cambiarle el servicio.`,
        )
      }

      profesional.servicioId = servicio.id
    }

    if (datos.jornada !== undefined && datos.jornada !== profesional.jornada) {
      // Cambiarle la jornada a un doctor que ya tiene pacientes citados los
      // dejaria fuera de su horario (aparecerian en "fuera de horario" y
      // nadie los llamaria). Se avisa en vez de moverlo callado.
      const citasFuturas = estado.citas.filter(
        (c) => c.profesionalId === profesional.id && c.estado === 'PROGRAMADA',
      )
      if (citasFuturas.length > 0 && datos.jornada !== 'COMPLETA') {
        const quedanFuera = citasFuturas.filter(
          (c) => bloqueDeFranja(horaColombia(c.horaCita)) !== datos.jornada,
        ).length
        if (quedanFuera > 0) {
          errorDeNegocio(
            `${profesional.nombre} tiene ${quedanFuera} cita(s) programada(s) que quedarian fuera de ${ETIQUETA_JORNADA[datos.jornada]}. Reubicalas o cancelalas antes de cambiarle la jornada.`,
          )
        }
      }

      profesional.jornada = datos.jornada
    }

    if (datos.moduloId !== undefined) {
      if (datos.moduloId) buscarModulo(datos.moduloId)
      profesional.moduloId = datos.moduloId || null
    }

    if (datos.activo === false && profesional.activo) {
      // DAR DE BAJA A UN DOCTOR NO ES SOLO ESCONDERLO DE LAS LISTAS.
      //
      // Su enlace de consultorio deja de servir en el acto
      // (`validarAccesoProfesional` exige que este activo), asi que:
      //   - si tiene un paciente adentro, ya no puede cerrarle el turno, y ese
      //     turno se queda abierto ocupando su casilla en el televisor;
      //   - sus citas siguen ahi, y admisiones puede registrar la llegada de
      //     esos pacientes: entran a la fila de un doctor que no puede llamar a
      //     nadie y se quedan esperando sin que ninguna pantalla lo advierta.
      //
      // Se avisa, igual que al cambiarle el servicio o la jornada, en vez de
      // dejar pacientes colgados en silencio.
      const abiertos = estado.turnos.filter(
        (t) =>
          t.profesionalId === profesional.id &&
          (t.estado === 'EN_ESPERA' || t.estado === 'LLAMADO' || t.estado === 'EN_ATENCION'),
      ).length
      if (abiertos > 0) {
        errorDeNegocio(
          `${profesional.nombre} tiene ${abiertos} paciente(s) sin cerrar. Cierra su atencion antes de darlo de baja.`,
        )
      }

      const hoy = diaColombia(ahoraISO())
      const citasPendientes = estado.citas.filter(
        (c) =>
          c.profesionalId === profesional.id &&
          c.estado === 'PROGRAMADA' &&
          diaColombia(c.horaCita) >= hoy,
      ).length
      if (citasPendientes > 0) {
        errorDeNegocio(
          `${profesional.nombre} tiene ${citasPendientes} cita(s) programada(s) de hoy en adelante. Reubicalas o cancelalas antes de darlo de baja.`,
        )
      }
    }

    if (datos.activo !== undefined) profesional.activo = datos.activo

    return profesional
  }

  // --- Parametros generales ---

  async configuracion(): Promise<ConfiguracionGuardada> {
    return { ...estado.configuracion }
  }

  async guardarConfiguracion(
    datos: Partial<ConfiguracionSistema>,
    opciones: { visto?: string } = {},
  ): Promise<ConfiguracionGuardada> {
    exigirConfiguracionAlDia(estado.configuracion.actualizadoEn, opciones.visto)

    const siguiente: ConfiguracionSistema = { ...estado.configuracion, ...datos }

    // Las cuatro horas de las jornadas se validan JUNTAS, no campo por campo:
    // cada una por separado puede ser una hora perfectamente valida y aun asi
    // dejar un horario imposible (la tarde empezando antes de que cierre la
    // mañana, o una jornada que termina antes de abrir). Un horario incoherente
    // no revienta nada, pero deja la parrilla vacia y al operador sin entender
    // por que no puede agendar; es mejor no dejar guardarlo.
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

    estado.configuracion = { ...siguiente, actualizadoEn: marcaSiguiente(estado.configuracion.actualizadoEn) }

    // Igual que la implementacion contra Postgres: las pantallas abiertas se
    // enteran al instante en vez de esperar a su resincronizacion. Las dos
    // cumplen el mismo contrato y tienen que comportarse igual, o las pruebas
    // darian por bueno algo que en el hospital no pasa.
    realtimeHub.publish({ tipo: 'configuracion.cambiada' })

    return { ...estado.configuracion }
  }

  // --- Acceso temporal de profesionales ---

  async crearAccesoProfesional(
    profesionalId: string,
    duracionMinutos: number,
  ): Promise<{ acceso: AccesoProfesional; token: string }> {
    buscarProfesional(profesionalId)

    if (
      !Number.isInteger(duracionMinutos) ||
      duracionMinutos < MINUTOS_ACCESO_MINIMO ||
      duracionMinutos > MINUTOS_ACCESO_MAXIMO
    ) {
      errorDeNegocio(
        `La vigencia del enlace debe estar entre ${MINUTOS_ACCESO_MINIMO} minutos y ${MINUTOS_ACCESO_MAXIMO / 60} horas.`,
      )
    }

    // Un doctor, un enlace activo: el anterior deja de servir en cuanto se
    // genera uno nuevo, para que no queden varios enlaces validos sueltos.
    for (const previo of estado.accesosProfesional) {
      if (previo.profesionalId === profesionalId && !previo.revocadoEn) {
        previo.revocadoEn = ahoraISO()
      }
    }

    const token = randomBytes(32).toString('base64url')
    const creadoEn = ahoraISO()
    const expiraEn = new Date(Date.now() + duracionMinutos * 60 * 1000).toISOString()

    const acceso: AccesoProfesional & { tokenHash: string } = {
      id: `acc-${crearId()}`,
      profesionalId,
      creadoEn,
      expiraEn,
      revocadoEn: null,
      ultimoUsoEn: null,
      tokenHash: hashToken(token),
    }
    estado.accesosProfesional.push(acceso)

    const { tokenHash: _tokenHash, ...accesoPublico } = acceso
    return { acceso: accesoPublico, token }
  }

  async validarAccesoProfesional(token: string): Promise<Profesional | null> {
    if (!token) return null
    const hash = hashToken(token)
    const acceso = estado.accesosProfesional.find((a) => a.tokenHash === hash)
    if (!acceso) return null
    if (acceso.revocadoEn) return null
    if (new Date(acceso.expiraEn).getTime() <= Date.now()) return null

    const profesional = estado.profesionales.find((p) => p.id === acceso.profesionalId && p.activo)
    if (!profesional) return null

    acceso.ultimoUsoEn = ahoraISO()
    return profesional
  }

  /** Ver `listarAccesosProfesional` en la implementacion contra Postgres. */
  async listarAccesosProfesional(): Promise<AccesoProfesional[]> {
    const masRecientesPrimero = estado.accesosProfesional
      .map(({ tokenHash: _tokenHash, ...acceso }) => acceso)
      .sort((a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime())

    // El ULTIMO de cada doctor, igual que la otra implementacion: como la lista
    // viene de mas reciente a mas antigua, el primero que aparece de cada uno es
    // el suyo.
    const vistos = new Set<string>()
    return masRecientesPrimero.filter((acceso) => {
      if (vistos.has(acceso.profesionalId)) return false
      vistos.add(acceso.profesionalId)
      return true
    })
  }

  async revocarAccesoProfesional(id: string): Promise<AccesoProfesional> {
    const acceso = estado.accesosProfesional.find((a) => a.id === id)
    if (!acceso) errorDeNegocio('El acceso indicado no existe.')
    if (!acceso.revocadoEn) acceso.revocadoEn = ahoraISO()

    const { tokenHash: _tokenHash, ...accesoPublico } = acceso
    return accesoPublico
  }
}

/**
 * Dos consultorios no pueden llamarse igual.
 *
 * El nombre del modulo es LO UNICO que se le dice al paciente para que sepa por
 * que puerta entrar ("turno C-014, consultorio 3"), y en la pantalla de la sala
 * de espera es lo que rotula cada casilla. Con dos "Consultorio 3" en el
 * televisor, ese dato deja de identificar una puerta y el paciente no tiene
 * forma de resolverlo. Nada lo impedia, aunque el propio catalogo se habia
 * numerado a mano para evitarlo.
 *
 * Se compara sin distinguir mayusculas ni espacios de sobra, que es como lo
 * lee una persona.
 */
function validarNombreDeModuloLibre(nombre: string, exceptoId?: string) {
  if (!nombre) errorDeNegocio('El nombre del consultorio o la ventanilla es obligatorio.')

  const normalizado = nombre.trim().toLowerCase()
  const repetido = estado.modulos.some(
    (m) => m.id !== exceptoId && m.nombre.trim().toLowerCase() === normalizado,
  )
  if (repetido) {
    errorDeNegocio(
      `Ya existe "${nombre}". El paciente solo tiene ese nombre para saber por que puerta entrar, asi que no puede haber dos iguales.`,
    )
  }
}

/**
 * Ver las funciones del mismo nombre en la implementacion contra Postgres.
 *
 * Aqui faltaban las dos, y esa ausencia no era inofensiva: como las pruebas
 * corren contra esta implementacion, la regla "dos servicios no pueden llamarse
 * igual" —que la base SI exige— era inverificable, y una regresion en la otra
 * implementacion no la hubiera detectado nadie.
 */
function validarNombreDeServicioLibre(nombre: string, exceptoId?: string) {
  const buscado = nombre.trim().toLowerCase()
  if (!buscado) errorDeNegocio('El nombre del servicio es obligatorio.')
  if (estado.servicios.some((s) => s.id !== exceptoId && s.nombre.trim().toLowerCase() === buscado)) {
    errorDeNegocio(`Ya existe un servicio llamado "${nombre}".`)
  }
}

function validarNombreDeProfesionalLibre(nombre: string, exceptoId?: string) {
  const buscado = nombre.trim().toLowerCase()
  if (estado.profesionales.some((p) => p.id !== exceptoId && p.nombre.trim().toLowerCase() === buscado)) {
    errorDeNegocio(`Ya existe un profesional llamado "${nombre}".`)
  }
}

function validarPrefijoLibre(prefijo: string) {
  const normalizado = prefijo.trim().toUpperCase()
  if (!normalizado) errorDeNegocio('El prefijo es obligatorio.')
  if (estado.servicios.some((s) => s.prefijo === normalizado)) {
    errorDeNegocio(`El prefijo ${normalizado} ya lo usa otro servicio.`)
  }
}

/**
 * Cierra la atencion que siguiera abierta en un modulo.
 *
 * Cuando el profesional pulsa "siguiente" esta diciendo, implicitamente, que
 * termino con el anterior (seccion 22, pasos 9 y 10).
 */
function cerrarAtencionAbierta(moduloId: string, exceptoTurnoId: string, profesionalId?: string) {
  for (const turno of estado.turnos) {
    if (turno.moduloId !== moduloId) continue
    if (turno.id === exceptoTurnoId) continue
    if (turno.estado !== 'LLAMADO' && turno.estado !== 'EN_ATENCION') continue
    // Nunca se cierra el paciente de otro profesional. `validarModuloParaLlamar`
    // ya lo impide antes de llegar aqui; se repite porque este cierre es
    // silencioso y automatico, y equivocarse aqui deja a un paciente marcado
    // como atendido sin que nadie lo haya atendido.
    if (profesionalId && turno.profesionalId && turno.profesionalId !== profesionalId) continue

    turno.estado = 'ATENDIDO'
    turno.horaAtencion = ahoraISO()
    turno.cerradoEn = turno.horaAtencion
    // NADIE lo cerro: se cerro solo al pasar al siguiente paciente. Queda
    // marcado para que en el historico no se confunda con una atencion que el
    // doctor dio por terminada, y para poder contar cuantos se cierran asi.
    turno.cerradoPor = null
    turno.cierreAutomatico = true

    if (turno.citaId) {
      const cita = estado.citas.find((c) => c.id === turno.citaId)
      if (cita) cita.estado = 'ATENDIDA'
    }
  }
}

export const turnoRepository: InMemoryTurnoRepository = new InMemoryTurnoRepository()

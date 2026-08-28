/**
 * Tipos de dominio del Sistema de Gestion y Llamado de Turnos.
 *
 * Estos tipos representan NUESTRAS necesidades funcionales, no la estructura de
 * ninguna API externa. Cuando el hospital comparta su API, el adaptador en
 * `lib/hospital` traducira entre estos tipos y el formato real de esa API.
 *
 * Fuente: "Documento de Requerimientos del Sistema - Sistema de Gestion y
 * Llamado de Turnos, ESE Hospital San Rafael de Chinu, v1.0" mas las
 * precisiones del hospital sobre el flujo real (ver `flujo` mas abajo).
 *
 * FLUJO REAL (confirmado por el hospital, no esta en el documento v1.0):
 *   1. La API del hospital entrega las CITAS del dia (paciente, profesional,
 *      servicio, hora).
 *   2. El paciente llega y admisiones lo busca por documento y registra su
 *      llegada. La cita pasa a PRESENTADO.
 *   3. Solo las citas PRESENTADO generan un TURNO en espera.
 *   4. El profesional (doctor) ve unicamente sus turnos del dia y pulsa
 *      "siguiente" cuando se desocupa.
 *   5. El llamado se refleja en la pantalla de la sala de espera y se anuncia
 *      por audio.
 *
 * Los servicios de ventanilla (admisiones, facturacion, SIAU) no tienen cita:
 * su fila es compartida, como en el documento original. Por eso `Servicio`
 * lleva `modoFila`.
 */

/** Estados del turno (requerimiento seccion 8). */
export type EstadoTurno =
  | 'EN_ESPERA'
  | 'LLAMADO'
  | 'EN_ATENCION'
  | 'ATENDIDO'
  | 'AUSENTE'
  | 'CANCELADO'

/** Prioridad de atencion (requerimiento seccion 14). Reglas a definir luego. */
export type PrioridadTurno = 'NORMAL' | 'PRIORITARIO'

/**
 * Como se forma la fila de un servicio.
 *
 * - `COMPARTIDA`: una sola fila por orden de llegada; la toma cualquier
 *   ventanilla libre (admisiones, facturacion, SIAU, autorizaciones).
 * - `POR_PROFESIONAL`: cada paciente viene con cita asignada a un profesional
 *   y solo ese profesional lo llama (consulta externa, odontologia, pediatria).
 */
export type ModoFila = 'COMPARTIDA' | 'POR_PROFESIONAL'

/** Servicio o area de atencion (ej: Admisiones, Odontologia, Pediatria). */
export interface Servicio {
  id: string
  nombre: string
  /** Prefijo configurable del turno, ej: "O" para Odontologia (RF-002). */
  prefijo: string
  modoFila: ModoFila
  activo: boolean
}

/** Modulo, consultorio o ventanilla de atencion (seccion 15). */
export interface Modulo {
  id: string
  nombre: string
  /** Servicio al que esta asignado el modulo, si aplica. */
  servicioId?: string | null
  activo: boolean
}

/**
 * Profesional que atiende: medico, odontologo, pediatra.
 *
 * Es distinto del usuario del sistema (`lib/usuarios/types.ts`): un profesional
 * existe en la agenda del hospital aunque todavia no tenga cuenta aqui. Cuando
 * la tenga, `usuarioId` los conecta y esa cuenta solo vera sus propios turnos.
 */
export interface Profesional {
  id: string
  nombre: string
  servicioId: string
  /** Consultorio habitual. El profesional puede cambiarlo al iniciar su jornada. */
  moduloId?: string | null
  /** Cuenta del sistema asociada, si ya la tiene. */
  usuarioId?: string | null
  activo: boolean
}

/**
 * Acceso temporal de un profesional a su consultorio, sin usuario ni
 * contrasena (RF pendiente de codigo, confirmado por el hospital: mientras
 * no exista la cuenta de cada doctor, el administrador genera un enlace de
 * 24 horas).
 *
 * El token en claro NUNCA se guarda: el repositorio solo persiste su hash
 * (ver `in-memory-repository.ts`). Por eso este tipo no tiene campo `token`;
 * se devuelve una unica vez desde `crearAccesoProfesional`.
 */
export interface AccesoProfesional {
  id: string
  profesionalId: string
  creadoEn: string
  expiraEn: string
  revocadoEn: string | null
  ultimoUsoEn: string | null
}

/** Estado de la cita dentro de nuestro flujo. */
export type EstadoCita = 'PROGRAMADA' | 'PRESENTADO' | 'ATENDIDA' | 'CANCELADA'

/**
 * Cita del dia, tal como la necesitamos.
 *
 * Origen: la API del hospital [PENDIENTE DE CONFIRMACION]. Guardamos el minimo
 * indispensable para operar el turno (seccion 17: no almacenar datos del
 * paciente que no sean necesarios). Nada de diagnostico, EPS ni historia.
 */
export interface Cita {
  id: string
  /** Documento del paciente. Solo se usa para buscarlo en admisiones. */
  documentoPaciente: string
  /** Nombre completo. NUNCA sale hacia la pantalla publica sin enmascarar. */
  nombrePaciente: string
  profesionalId: string
  servicioId: string
  /** Hora programada, ISO 8601. */
  horaCita: string
  estado: EstadoCita
}

/** Turno de atencion (requerimiento RF-001). */
export interface Turno {
  id: string
  /** Codigo visible del turno, ej: "O-025". */
  codigo: string
  servicioId: string
  estado: EstadoTurno
  prioridad: PrioridadTurno
  fechaGeneracion: string
  horaLlamado?: string | null
  horaAtencion?: string | null
  /** Modulo/consultorio/ventanilla asignado al llamar. */
  moduloId?: string | null
  /** Usuario del sistema que llamo el turno. */
  funcionarioId?: string | null
  /** Numero de veces que el turno fue llamado (seccion 12). */
  vecesLlamado: number

  // --- Solo en servicios POR_PROFESIONAL ---
  /** Cita que origino el turno, si vino de la agenda. */
  citaId?: string | null
  /** Profesional al que le corresponde este paciente. */
  profesionalId?: string | null
  /**
   * Hora programada de la cita (no la hora de llegada), para que el
   * profesional ordene su fila del dia. Solo presente si el turno vino de
   * una cita.
   */
  horaCita?: string | null
  /**
   * Nombre completo del paciente. Solo para las pantallas CON sesion
   * (admisiones, consultorio). Para la pantalla publica se envia enmascarado;
   * ver `lib/turnos/privacidad.ts`.
   */
  nombrePaciente?: string | null
}

/**
 * Situacion de una cita dentro de la agenda del doctor, mezclando el estado
 * de la CITA (aun no genera turno) con el del TURNO que genera cuando el
 * paciente ya llego. Existe para que el doctor entienda POR QUE no puede
 * llamar a alguien que ve en su lista: si sigue en PROGRAMADA es porque
 * admisiones todavia no registro su llegada, no porque el sistema falle.
 */
export type EstadoAgendaItem =
  | 'PROGRAMADA'
  | 'EN_ESPERA'
  | 'LLAMADO'
  | 'EN_ATENCION'
  | 'ATENDIDA'
  | 'AUSENTE'

/**
 * Una fila de la agenda del dia de un profesional: la cita, y si ya genero
 * turno, su situacion actual. `citaId` siempre esta presente porque toda fila
 * de la agenda parte de una cita; `turnoId` solo existe desde que el paciente
 * registro su llegada.
 */
export interface ItemAgendaProfesional {
  citaId: string
  turnoId: string | null
  documentoPaciente: string
  nombrePaciente: string
  /** Hora programada de la cita, ISO 8601. */
  horaCita: string
  estado: EstadoAgendaItem
  /** Codigo del turno, si ya existe (desde que el paciente llego). */
  codigo: string | null
  vecesLlamado: number
}

/** Filtros para consultar el historico (requerimiento seccion 18). */
export interface FiltroHistorico {
  fecha?: string
  servicioId?: string
  codigo?: string
  estado?: EstadoTurno
  funcionarioId?: string
  profesionalId?: string
  moduloId?: string
}

/**
 * Una casilla de la pantalla de la sala de espera: que se esta atendiendo en
 * cada consultorio o ventanilla ahora mismo.
 *
 * Se arma en el servidor y ya viene enmascarada, porque la pantalla no tiene
 * sesion (requerimiento seccion 6.3).
 */
export interface CasillaPantalla {
  moduloId: string
  moduloNombre: string
  servicioId: string
  servicioNombre: string
  profesionalNombre?: string | null
  turnoId?: string | null
  codigo?: string | null
  /** Nombre del paciente ya enmascarado, ej: "JUAN P.". */
  pacienteVisible?: string | null
  horaLlamado?: string | null
  /** Cuantas veces se llamo; la pantalla lo usa para repetir la animacion. */
  vecesLlamado?: number
}

/**
 * Parametros generales configurables por el administrador
 * (requerimiento secciones 6.1 y 11).
 */
export interface ConfiguracionPantalla {
  /** Activa o desactiva el llamado por audio. */
  audioActivo: boolean
  /** Cuantas veces se repite cada anuncio, 1 a 3 (seccion 11). */
  repeticionesAudio: number
  /** Volumen del anuncio, 0 a 1. */
  volumen: number
  /** Cuantos llamados recientes se listan en la pantalla. */
  ultimosVisibles: number
  /** Mensaje institucional que corre al pie de la pantalla. */
  mensajePie: string
  /**
   * Maximo de citas que se le pueden agendar a un profesional en un mismo dia
   * (su "turno"/jornada). 0 = sin limite. Lo configura el administrador; el
   * operador no puede pasarse al crear citas.
   */
  maxCitasPorProfesional: number
}

/** Indicadores de atencion (requerimiento seccion 19). */
export interface EstadisticasServicio {
  servicioId: string
  servicioNombre: string
  generados: number
  atendidos: number
  ausentes: number
  pendientes: number
  /** Minutos promedio entre generar el turno y llamarlo. */
  minutosEsperaPromedio: number | null
  /** Minutos promedio entre el llamado y el cierre de la atencion. */
  minutosAtencionPromedio: number | null
}

export interface EstadisticasDia {
  fecha: string
  total: EstadisticasServicio
  porServicio: EstadisticasServicio[]
  porFuncionario: Array<{ funcionarioId: string; atendidos: number }>
}

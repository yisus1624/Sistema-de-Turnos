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
 * Jornada en la que atiende un profesional (confirmado con el hospital: unos
 * doctores atienden en la mañana y otros en la tarde).
 *
 * De aqui sale en que franjas se le pueden agendar citas: un doctor de mañana
 * no acepta una cita de las 3 p. m. Las horas de cada jornada son las mismas
 * para todo el hospital y las fija el administrador en la configuracion; lo
 * que cambia por doctor es en cual de las dos trabaja.
 */
export type Jornada = 'MANANA' | 'TARDE' | 'COMPLETA'

/**
 * Lo que un doctor trabajo (o va a trabajar) UN DIA concreto.
 *
 * LA JORNADA NO ES UN DATO DEL DOCTOR, ES UN DATO DEL DOCTOR Y EL DIA. En el
 * hospital el mismo medico hace el lunes completo, el martes solo la mañana y
 * el miercoles no viene. Un unico campo en su ficha no puede decir eso: cada
 * carga lo machacaba con el veredicto del ultimo archivo y se perdia el resto.
 *
 * NO SE GUARDA EN NINGUNA TABLA, SE DEDUCE. Las citas de cada dia ya estan
 * guardadas y no se borran: de sus horas sale la jornada de ese dia, hacia
 * atras, para cualquier dia que se haya cargado. Guardarla aparte seria
 * duplicar un dato que ya existe y abrir la puerta a que las dos copias dejen
 * de coincidir, que es exactamente el problema que se esta arreglando.
 */
export interface JornadaDelDia {
  profesionalId: string
  /**
   * Lo que dicen sus citas de ese dia. `null` es "no trabaja": ese dia no
   * tiene ni un paciente, y eso es una respuesta, no un dato que falte.
   */
  jornada: Jornada | null
  /** Cuantos pacientes tiene ese dia. */
  citas: number
  /** Primera y ultima hora con paciente, para poder mirarlo y creerlo. */
  desde: string | null
  hasta: string | null
}

/** Un doctor al que un recalculo le corrigio la jornada habitual. */
export interface AjusteDeJornada {
  nombre: string
  jornada: Jornada
  /** La que tenia antes, para que el registro de actividad diga el cambio entero. */
  anterior: Jornada
  /** En cuantos dias del periodo trabajo. Es lo que sostiene el veredicto. */
  diasTrabajados: number
}

/**
 * Lo que devuelve recalcular las jornadas habituales.
 *
 * Vive aqui y no junto al codigo que lo calcula porque es la forma de una
 * respuesta de la API: lo lee la pantalla de Profesionales, que corre en el
 * navegador y no puede importar nada que toque la base de datos.
 */
export interface ResumenRecalculo {
  desde: string
  hasta: string
  diasMirados: number
  doctoresRevisados: number
  /** Doctores sin ni una cita en el periodo. No se les toca. */
  sinCitas: number
  ajustes: AjusteDeJornada[]
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
  /** En que jornada atiende. Decide a que horas se le puede agendar. */
  jornada: Jornada
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

  // --- Trazabilidad de la cita ---
  //
  // Una cita de hospital no es un dato que solo se crea y se borra: se mueve y
  // se cancela, y de las dos cosas hay que poder responder despues quien,
  // cuando y por que. Antes cancelar dejaba el registro exactamente igual que
  // antes salvo el estado, asi que "¿quien cancelo la cita de este paciente?"
  // no tenia respuesta en ninguna parte.

  /** Quien creo la cita y cuando. */
  creadaEn?: string | null
  creadaPor?: string | null

  /**
   * Hora a la que se cito ORIGINALMENTE, si la cita se ha movido. Se conserva
   * la primera de todas, no la anterior: lo que se quiere poder reconstruir es
   * a que hora se le dijo al paciente que viniera la primera vez.
   */
  horaCitaOriginal?: string | null
  /** Cuantas veces se ha movido. Un numero alto es una queja esperando. */
  vecesReprogramada?: number
  reprogramadaEn?: string | null
  reprogramadaPor?: string | null
  motivoReprogramacion?: string | null

  canceladaEn?: string | null
  canceladaPor?: string | null
  motivoCancelacion?: string | null
}

// ---------------------------------------------------------------------------
// EL HORARIO DEL DIA
//
// La agenda no es una lista de citas sueltas: es una parrilla. Cada doctor
// tiene una columna y cada franja de `duracionCitaMinutos` una fila, asi que
// una celda es "este doctor, a esta hora". Esa forma es la que evita el
// problema real de una agenda de hospital, que es agendar dos pacientes a la
// misma hora con el mismo doctor: en una parrilla la celda ya esta ocupada y
// se ve.
//
// El horario se arma en el servidor (`horarioDelDia`) y no en la pantalla,
// porque depende de la configuracion y de la jornada de cada doctor, que son
// reglas del dominio y no de la vista.
// ---------------------------------------------------------------------------

/** Una cita colocada en su franja de la parrilla. */
export interface CitaEnHorario {
  id: string
  documentoPaciente: string
  nombrePaciente: string
  profesionalId: string
  /** Franja a la que pertenece, "HH:MM" en hora de Colombia. */
  hora: string
  /** Hora programada completa, ISO 8601. */
  horaCita: string
  estado: EstadoCita
  /**
   * Cuantas veces se ha movido esta cita. Se lleva hasta la parrilla para poder
   * avisarlo al abrir el detalle: un paciente al que ya le movieron la cita
   * tres veces es una queja esperando, y quien la vuelve a mover tiene que
   * saberlo antes de hacerlo.
   */
  vecesReprogramada?: number
  /** Hora a la que se le cito la primera vez, si se ha movido. */
  horaCitaOriginal?: string | null
}

/** Una columna de la parrilla: el doctor que atiende esa jornada. */
export interface ColumnaHorario {
  profesionalId: string
  profesionalNombre: string
  servicioNombre: string
  moduloNombre: string | null
  /**
   * Citas que tiene ese doctor en esa jornada.
   *
   * NO HAY "CUPOS TOTALES", y no es un olvido. Cada doctor lleva su propio
   * ritmo —uno cita cada diez minutos, otro cada trece, otro mete treinta
   * pacientes donde el de al lado mete veintisiete— y eso lo decide la agenda
   * del hospital, no este sistema. Dividir la jornada entre la duracion de la
   * consulta daba un "27/30" inventado: ni los 30 existian ni sobraban 3.
   */
  citas: number
}

/**
 * Una fila de la parrilla: una hora.
 *
 * LAS FILAS SALEN DE LAS CITAS DEL DIA, no solo de la configuracion. Antes la
 * parrilla era una rejilla fija (7:00, 7:10, 7:20...) y todo lo que no caia
 * justo ahi se iba a "fuera de horario": con la agenda real del hospital, que
 * trae citas a las 7:09 y a las 7:13, eso dejaba columnas enteras en blanco con
 * sus pacientes amontonados en una lista al pie. El doctor con mas trabajo del
 * dia se veia igual que uno que no vino.
 */
export interface FilaHorario {
  /** "HH:MM" en hora de Colombia. */
  hora: string
  /**
   * Si a esta hora se puede agendar a mano.
   *
   * Lo son las franjas de la configuracion. Las horas que entraron porque
   * alguien tiene una cita ahi (las 7:09) se ven, pero no se ofrecen: agendar
   * en ellas lo rechaza el servidor, y ofrecer un boton que siempre falla es
   * peor que no ofrecerlo.
   */
  agendable: boolean
}

/** La parrilla de una jornada (la de la mañana o la de la tarde). */
export interface BloqueHorario {
  jornada: 'MANANA' | 'TARDE'
  etiqueta: string
  /** Rango de la jornada, "HH:MM", para mostrarlo en el encabezado. */
  desde: string
  hasta: string
  /** Filas de la jornada: las franjas configuradas mas las horas con cita. */
  filas: FilaHorario[]
  /** Doctores que atienden en esta jornada, en el orden del catalogo. */
  columnas: ColumnaHorario[]
  /**
   * Citas del bloque, indexadas por `${profesionalId}|${hora}`.
   *
   * Es una LISTA y no una cita suelta porque el hospital puede citar a dos
   * pacientes con el mismo doctor a la misma hora. Pasa, y guardando una sola
   * el otro paciente desapareceria de la agenda sin que nadie se entere, hasta
   * que se presenta en la ventanilla.
   */
  citas: Record<string, CitaEnHorario[]>
}

/** El horario completo de un dia. */
export interface HorarioDia {
  /** Dia AAAA-MM-DD en hora de Colombia. */
  fecha: string
  duracionCitaMinutos: number
  bloques: BloqueHorario[]
  /**
   * Citas del dia que no tienen columna donde caer.
   *
   * Ya no son las que "no encajan en la rejilla" —eso lo resolvio que las filas
   * salgan de las propias citas—, sino las del doctor que no esta en la
   * parrilla: se le dio de baja, o se le paso a un servicio que atiende por
   * orden de llegada, despues de haberle agendado. NO se descartan en silencio:
   * un paciente que desaparece de la agenda igual se presenta en el hospital.
   */
  fueraDeHorario: CitaEnHorario[]
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
  /**
   * Hora del ULTIMO llamado. Es la que ordena la pantalla, asi que se actualiza
   * cada vez que se repite: la casilla que acaba de sonar tiene que quedar
   * arriba.
   */
  horaLlamado?: string | null
  /**
   * Hora del PRIMER llamado, que ya no se toca nunca mas.
   *
   * Existe porque `horaLlamado` se sobrescribe al repetir, y con eso se perdia
   * el dato con el que se mide la espera del paciente: repetir el llamado
   * alargaba, en el informe, el tiempo que el paciente habia esperado. La
   * espera se mide SIEMPRE contra este campo.
   */
  horaPrimerLlamado?: string | null
  horaAtencion?: string | null
  /** Modulo/consultorio/ventanilla asignado al llamar. */
  moduloId?: string | null
  /** Usuario del sistema que llamo el turno. */
  funcionarioId?: string | null
  /** Numero de veces que el turno fue llamado (seccion 12). */
  vecesLlamado: number

  // --- Quien y como se cerro ---

  /**
   * Quien cerro el turno (lo dio por atendido o por ausente). Puede ser un
   * usuario del sistema o el id del profesional, que entra por enlace y no
   * tiene cuenta.
   *
   * Antes solo se guardaba `funcionarioId`, que es quien LLAMO: "¿quien dio por
   * ausente a este paciente?" no se podia responder.
   */
  cerradoPor?: string | null
  /** Cuando se cerro, para atendidos Y para ausentes. */
  cerradoEn?: string | null
  /**
   * El turno no lo cerro nadie: se cerro solo al pulsar el doctor "siguiente"
   * sin haber cerrado al anterior.
   *
   * Importa distinguirlo. Un cierre automatico se veia en el historico igual
   * que uno explicito, asi que un paciente que se levanto y se fue quedaba
   * registrado como atendido, con una hora de atencion que nadie vivio.
   */
  cierreAutomatico?: boolean

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
  /**
   * El turno se cerro solo al pasar al siguiente paciente, sin que el doctor lo
   * diera por atendido. Se lleva hasta la agenda para poder mostrarlo distinto:
   * si no, un paciente que se levanto y se fue se ve exactamente igual que uno
   * atendido, y el doctor no tiene como notar la diferencia.
   */
  cierreAutomatico?: boolean
}

/** Filtros para consultar el historico (requerimiento seccion 18). */
export interface FiltroHistorico {
  fecha?: string
  /** Rango de fechas (inclusive), alternativo a `fecha`. Usado en reportes. */
  fechaDesde?: string
  fechaHasta?: string
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
 * NO LLEVA NINGUN DATO DEL PACIENTE, ni siquiera enmascarado (decision del
 * hospital). La pantalla de la sala de espera no tiene sesion y la ve todo el
 * que pase por el pasillo, asi que lo unico que sale hacia alla es a que
 * consultorio va cada turno. Antes viajaba el nombre abreviado ("JUAN P.");
 * quitarlo del tipo convierte esa regla en algo que el codigo no puede
 * saltarse por descuido, en vez de una norma que hay que recordar.
 *
 * Al paciente se le identifica por su TURNO, que es justo para lo que sirve:
 * se lo entrega admisiones al registrar su llegada, junto con el consultorio y
 * el nombre del doctor (requerimiento secciones 6.3 y 17).
 */
export interface CasillaPantalla {
  moduloId: string
  moduloNombre: string
  servicioId: string
  servicioNombre: string
  profesionalNombre?: string | null
  turnoId?: string | null
  codigo?: string | null
  horaLlamado?: string | null
  /** Cuantas veces se llamo; la pantalla lo usa para repetir la animacion. */
  vecesLlamado?: number
}

/**
 * Lo que admisiones le entrega al paciente cuando registra su llegada.
 *
 * Es la contraparte de `CasillaPantalla`: como la pantalla ya no dice nombres,
 * el paciente tiene que salir de admisiones sabiendo tres cosas — su turno, a
 * que consultorio va y quien lo atiende. El consultorio es el habitual del
 * doctor; puede cambiar si ese dia se mueve de consultorio, y por eso en la
 * pantalla manda siempre lo que diga la casilla.
 */
export interface ComprobanteLlegada {
  turnoId: string
  codigo: string
  servicioNombre: string
  profesionalNombre: string | null
  moduloNombre: string | null
  /** Hora programada de la cita, ISO 8601. */
  horaCita: string | null
  /** Solo para la pantalla de admisiones, que si tiene sesion. */
  nombrePaciente: string | null
}

/**
 * Parametros generales del sistema, configurables por el administrador
 * (requerimiento secciones 6.1 y 11).
 */
export interface ConfiguracionSistema {
  /**
   * Activa o desactiva el sonido del llamado. Apagado, la pantalla sigue
   * mostrando los turnos, en silencio.
   */
  audioActivo: boolean
  /** Volumen de la campanita del llamado, 0 a 1. */
  volumen: number
  /** Cuantos llamados recientes se listan en la pantalla. */
  ultimosVisibles: number
  /** Mensaje institucional que corre al pie de la pantalla. */
  mensajePie: string

  // --- Agenda ---
  //
  // Estos cuatro parametros son los que dibujan la parrilla del horario. Aqui
  // esta el tope de citas por doctor: no hace falta un numero aparte, porque
  // el cupo del dia es exactamente cuantas franjas caben en su jornada.

  /**
   * Cuanto dura cada consulta, en minutos. Es el alto de cada franja: con 15
   * minutos, una jornada de 7:00 a 12:00 da 20 citas por doctor.
   */
  duracionCitaMinutos: number
  /** Comienzo de la jornada de la mañana, "HH:MM" en hora de Colombia. */
  jornadaMananaInicio: string
  /** Fin de la jornada de la mañana (exclusivo: no se agenda a esta hora). */
  jornadaMananaFin: string
  /** Comienzo de la jornada de la tarde, "HH:MM". */
  jornadaTardeInicio: string
  /** Fin de la jornada de la tarde (exclusivo). */
  jornadaTardeFin: string
}

/** Indicadores de atencion (requerimiento seccion 19). */
export interface EstadisticasServicio {
  servicioId: string
  servicioNombre: string
  generados: number
  atendidos: number
  ausentes: number
  pendientes: number
  /**
   * Turnos que nadie cerro: se cerraron solos cuando el doctor paso al
   * siguiente paciente. Se cuentan aparte de `atendidos` porque no consta que
   * esa atencion ocurriera; un numero alto aqui quiere decir que en ese
   * servicio no se esta cerrando la atencion y los tiempos no son de fiar.
   */
  cerradosAutomaticamente: number
  /**
   * Citas de ese dia que nunca registraron llegada: el paciente NO ASISTIO.
   *
   * No es lo mismo que `ausentes`, que son los que si llegaron y luego no
   * respondieron al llamado. La inasistencia a la cita no se media en ninguna
   * parte porque, al no haber turno, esos pacientes no existian en el
   * historico; es justo el indicador que pide un hospital.
   */
  inasistencias: number
  /** Citas agendadas ese dia, para poder leer la inasistencia como porcentaje. */
  citasAgendadas: number
  /** Minutos promedio entre generar el turno y el PRIMER llamado. */
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

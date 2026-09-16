import type {
  AccesoProfesional,
  CasillaPantalla,
  Cita,
  ComprobanteLlegada,
  ConfiguracionSistema,
  EstadisticasDia,
  FiltroHistorico,
  HorarioDia,
  ItemAgendaProfesional,
  Jornada,
  JornadaDelDia,
  Modulo,
  Profesional,
  Servicio,
  Turno,
} from './types'

/**
 * Contrato de acceso a datos del sistema de turnos.
 *
 * La interfaz de usuario y los servicios de dominio SIEMPRE hablan con este
 * contrato, nunca directamente con una base de datos ni con una API concreta.
 * Esto permite cambiar la fuente de datos sin reescribir la aplicacion.
 *
 * Implementaciones:
 *   - En memoria (actual, temporal, para desarrollo sin persistencia).
 *   - API del hospital -> `lib/hospital`  [PENDIENTE DE CONFIRMACION]
 *
 * NOTA: los metodos reflejan las operaciones funcionales del flujo acordado
 * (citas -> llegada -> turno -> llamado -> cierre). NO representan endpoints
 * reales del hospital: esos aun no se conocen.
 */
export interface TurnoRepository {
  // --- Catalogos (administracion, secciones 15 y 16) ---
  /**
   * Servicios y modulos. Por defecto solo los ACTIVOS, que es lo que consumen
   * la pantalla, la agenda y el llamado. La administracion pide tambien los
   * inactivos, que es la unica forma de volver a activarlos.
   */
  listarServicios(incluirInactivos?: boolean): Promise<Servicio[]>
  listarModulos(servicioId?: string, incluirInactivos?: boolean): Promise<Modulo[]>
  /**
   * Profesionales. Por defecto solo los activos, que es lo que necesitan la
   * agenda y el llamado; la administracion pide tambien los inactivos para
   * poder volver a activarlos.
   */
  listarProfesionales(servicioId?: string, incluirInactivos?: boolean): Promise<Profesional[]>
  /** Profesional asociado a una cuenta del sistema, si la tiene. */
  profesionalDeUsuario(usuarioId: string): Promise<Profesional | null>

  // --- Admisiones: de la cita al turno ---
  // --- Agenda de citas ---
  // TEMPORAL: en produccion las citas las trae la API del hospital. Estos
  // metodos permiten cargarlas a mano durante el demo.
  listarCitas(filtro?: { fecha?: string; profesionalId?: string }): Promise<Cita[]>
  crearCita(datos: {
    documentoPaciente: string
    nombrePaciente: string
    profesionalId: string
    horaCita: string
    usuarioId?: string
  }): Promise<Cita>
  /**
   * Cancela una cita dejando constancia de quien y por que. Los dos datos son
   * lo que permite responderle despues al paciente que viene a reclamar.
   */
  cancelarCita(citaId: string, datos?: { usuarioId?: string; motivo?: string }): Promise<Cita>
  /**
   * Mueve una cita de hora (y opcionalmente de doctor) conservando el mismo
   * registro, con su historial de cuantas veces se ha movido.
   *
   * Es distinto de cancelar y volver a crear: asi quedaban dos citas sueltas
   * sin nada que dijera que son el mismo paciente reubicado. La hora nueva pasa
   * por las mismas reglas de la parrilla que una cita nueva.
   */
  reprogramarCita(
    citaId: string,
    datos: { horaCita: string; profesionalId?: string; motivo?: string; usuarioId?: string },
  ): Promise<Cita>
  /**
   * El horario de un dia: la parrilla de jornada de la mañana y jornada de la
   * tarde, con una columna por doctor y una fila por franja.
   *
   * Es la vista con la que se trabaja la agenda (ver `HorarioDia` en
   * `types.ts`). Se arma en el servidor porque depende de la configuracion y
   * de la jornada de cada doctor, que son reglas del dominio.
   */
  horarioDelDia(fecha: string): Promise<HorarioDia>

  /**
   * Que trabajo cada doctor UN DIA concreto, deducido de sus citas de ese dia.
   *
   * Es la trazabilidad de jornadas: el mismo medico hace el lunes completo, el
   * martes solo la mañana y el miercoles no viene, y con un solo campo en su
   * ficha eso no se puede ni ver ni consultar hacia atras. Aqui se responde
   * por dia, para cualquier dia que ya este cargado.
   *
   * Solo devuelve a los doctores que ese dia TIENEN citas. El que no aparece
   * no trabajo: ver `JornadaDelDia` en `types.ts`.
   */
  jornadasDelDia(fecha: string): Promise<JornadaDelDia[]>

  /**
   * TEMPORAL (solo pruebas): borra las citas y los turnos de hoy para que el
   * panel de simulacion de carga pueda arrancar de cero. Sin esto, las citas
   * ya usadas quedan como PRESENTADO/ATENDIDA y la siguiente corrida se queda
   * sin pacientes (y ademas topa el maximo de citas por profesional).
   */
  reiniciarDatosDeHoy(): Promise<void>

  /**
   * Busca las citas de UN DIA (por defecto hoy) por documento del paciente,
   * para que admisiones registre su llegada. Origen real: API del hospital
   * [PENDIENTE].
   */
  buscarCitasPorDocumento(documento: string, fecha?: string): Promise<Cita[]>
  /**
   * Citas del paciente en otros dias, solo para informarle cuando le toca. No
   * se les registra la llegada.
   */
  otrasCitasDelPaciente(documento: string, fecha?: string): Promise<Cita[]>
  /**
   * Registra que el paciente llego: la cita pasa a PRESENTADO y se genera su
   * turno EN_ESPERA en la fila del profesional correspondiente.
   */
  registrarLlegada(citaId: string): Promise<Turno>
  /**
   * Turno, consultorio y doctor de un turno ya generado, para que admisiones
   * se lo dicte al paciente. Ver `ComprobanteLlegada`.
   */
  comprobanteDeLlegada(turnoId: string): Promise<ComprobanteLlegada>
  /** Turnos sin cita, para los servicios de ventanilla (fila compartida). */
  generarTurnoDeVentanilla(servicioId: string): Promise<Turno>
  /**
   * Agenda completa de un profesional para un dia (formato AAAA-MM-DD): TODAS
   * sus citas de ese dia, hayan generado turno o no. A diferencia de
   * `listarPendientes` (solo EN_ESPERA), esto le permite al doctor ver por
   * que un paciente todavia no aparece para llamar: porque no ha registrado
   * su llegada en admisiones.
   */
  agendaProfesional(profesionalId: string, fecha: string): Promise<ItemAgendaProfesional[]>

  // --- Operacion (secciones 9, 12 y 13) ---
  /**
   * Turnos en espera. Se filtra por servicio (fila compartida) o por
   * profesional (cada doctor ve solo los suyos).
   */
  listarPendientes(filtro: { servicioId?: string; profesionalId?: string }): Promise<Turno[]>
  /**
   * Si el turno pertenece a ese profesional. Es lo que impide que un doctor
   * cierre el turno de otro cambiando el id en la URL de su enlace.
   */
  turnoEsDelProfesional(turnoId: string, profesionalId: string): Promise<boolean>
  /**
   * El paciente que el profesional tiene al frente ahora mismo (su ultimo
   * turno LLAMADO o EN_ATENCION del dia), o null.
   */
  turnoEnAtencion(profesionalId: string, fecha: string): Promise<Turno | null>
  /** Llama el siguiente turno y lo asigna a un modulo (seccion 9). */
  llamarSiguiente(params: {
    servicioId?: string
    profesionalId?: string
    moduloId: string
    funcionarioId: string
  }): Promise<Turno | null>
  /** Repite el llamado, incrementando el contador (seccion 12). */
  repetirLlamado(turnoId: string): Promise<Turno>
  /**
   * Cierra el turno. `cerradoPor` es quien lo cierra (usuario del sistema, o el
   * id del profesional cuando entra por su enlace): sin el no se podia
   * responder quien dio por atendido o por ausente a un paciente.
   */
  marcarAtendido(turnoId: string, cerradoPor?: string): Promise<Turno>
  marcarAusente(turnoId: string, cerradoPor?: string): Promise<Turno>

  // --- Pantalla de la sala de espera (seccion 10) ---
  /**
   * Estado completo de la pantalla: una casilla por consultorio o ventanilla
   * activa, con el turno que esta atendiendo. Ya viene enmascarado, porque la
   * pantalla no tiene sesion.
   */
  estadoPantalla(): Promise<CasillaPantalla[]>
  /** Ultimos turnos llamados, para la lista lateral de la pantalla. */
  ultimosLlamados(limite?: number): Promise<CasillaPantalla[]>

  // --- Historico / estadisticas (secciones 18 y 19) ---
  historico(filtro: FiltroHistorico): Promise<Turno[]>
  estadisticas(fecha: string): Promise<EstadisticasDia>

  // --- Administracion de catalogos (secciones 6.1 y 15) ---
  crearServicio(datos: Omit<Servicio, 'id'>): Promise<Servicio>
  actualizarServicio(id: string, datos: Partial<Omit<Servicio, 'id'>>): Promise<Servicio>
  /**
   * Borra un servicio del catalogo.
   *
   * Solo se puede borrar un servicio que no haya llegado a operar: si tiene
   * turnos, citas o profesionales, se rechaza y el camino es desactivarlo.
   * Borrarlo dejaria el historico apuntando a un servicio inexistente, que es
   * justo lo que el requerimiento (seccion 18) no permite perder.
   */
  eliminarServicio(id: string): Promise<void>
  crearModulo(datos: Omit<Modulo, 'id'>): Promise<Modulo>
  actualizarModulo(id: string, datos: Partial<Omit<Modulo, 'id'>>): Promise<Modulo>
  /**
   * Alta de un doctor en el catalogo. Mientras no exista la API del hospital,
   * los profesionales se cargan a mano desde administracion.
   */
  crearProfesional(datos: {
    nombre: string
    servicioId: string
    jornada: Jornada
    moduloId?: string | null
  }): Promise<Profesional>
  actualizarProfesional(
    id: string,
    datos: Partial<{
      nombre: string
      servicioId: string
      jornada: Jornada
      moduloId: string | null
      activo: boolean
    }>,
  ): Promise<Profesional>

  // --- Parametros generales (secciones 6.1 y 11) ---
  configuracion(): Promise<ConfiguracionSistema>
  guardarConfiguracion(datos: Partial<ConfiguracionSistema>): Promise<ConfiguracionSistema>

  // --- Acceso temporal de profesionales (enlace de 24h, sin usuario/clave) ---
  /**
   * Genera un enlace nuevo para el profesional, vigente por `duracionMinutos`
   * desde ahora (el hospital tiene turnos de manana, tarde y noche: la
   * vigencia la elige el administrador, no es fija). Revoca cualquier acceso
   * vigente que tuviera: un doctor, un enlace activo a la vez. El `token` en
   * claro solo viaja en este retorno; el repositorio guarda unicamente su
   * hash.
   */
  crearAccesoProfesional(
    profesionalId: string,
    duracionMinutos: number,
  ): Promise<{ acceso: AccesoProfesional; token: string }>
  /**
   * Valida el token del enlace. Devuelve null si no existe, ya vencio o fue
   * revocado. Si es valido, registra `ultimoUsoEn`.
   */
  validarAccesoProfesional(token: string): Promise<Profesional | null>
  listarAccesosProfesional(): Promise<AccesoProfesional[]>
  revocarAccesoProfesional(id: string): Promise<AccesoProfesional>
}

/**
 * Rango permitido para la vigencia del enlace temporal del profesional (RF
 * pendiente, confirmado por el hospital). El minimo evita enlaces
 * inservibles por error de dedo; el maximo evita dejar una llave viva
 * indefinidamente, que es el riesgo real de este mecanismo.
 *
 * Viven en el contrato y no en una implementacion porque son la REGLA, no un
 * detalle de donde se guarden los accesos: las dos implementaciones tienen que
 * rechazar exactamente las mismas vigencias.
 */
export const MINUTOS_ACCESO_MINIMO = 15
export const MINUTOS_ACCESO_MAXIMO = 72 * 60

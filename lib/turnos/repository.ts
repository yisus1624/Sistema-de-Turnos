import type {
  AccesoProfesional,
  CasillaPantalla,
  Cita,
  ConfiguracionPantalla,
  EstadisticasDia,
  FiltroHistorico,
  ItemAgendaProfesional,
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
  listarServicios(): Promise<Servicio[]>
  listarModulos(servicioId?: string): Promise<Modulo[]>
  listarProfesionales(servicioId?: string): Promise<Profesional[]>
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
  }): Promise<Cita>
  cancelarCita(citaId: string): Promise<Cita>

  /**
   * Busca las citas del dia por documento del paciente, para que admisiones
   * registre su llegada. Origen real: API del hospital [PENDIENTE].
   */
  buscarCitasPorDocumento(documento: string): Promise<Cita[]>
  /**
   * Registra que el paciente llego: la cita pasa a PRESENTADO y se genera su
   * turno EN_ESPERA en la fila del profesional correspondiente.
   */
  registrarLlegada(citaId: string): Promise<Turno>
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
  /** Llama el siguiente turno y lo asigna a un modulo (seccion 9). */
  llamarSiguiente(params: {
    servicioId?: string
    profesionalId?: string
    moduloId: string
    funcionarioId: string
  }): Promise<Turno | null>
  /** Repite el llamado, incrementando el contador (seccion 12). */
  repetirLlamado(turnoId: string): Promise<Turno>
  marcarAtendido(turnoId: string): Promise<Turno>
  marcarAusente(turnoId: string): Promise<Turno>

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
  crearModulo(datos: Omit<Modulo, 'id'>): Promise<Modulo>
  actualizarModulo(id: string, datos: Partial<Omit<Modulo, 'id'>>): Promise<Modulo>

  // --- Parametros generales (secciones 6.1 y 11) ---
  configuracion(): Promise<ConfiguracionPantalla>
  guardarConfiguracion(datos: Partial<ConfiguracionPantalla>): Promise<ConfiguracionPantalla>

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

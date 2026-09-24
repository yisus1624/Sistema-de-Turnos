import type { PlanDeRetroceso } from './reglas-retroceso'
import type {
  AccionSobreTurno,
  ActividadCatalogo,
  AccesoProfesional,
  Cita,
  ComprobanteLlegada,
  ConfiguracionGuardada,
  ConfiguracionSistema,
  EstadisticasDia,
  EstadoPantalla,
  FiltroHistorico,
  FiltroTurnoAbierto,
  PeticionDeLlamado,
  HorarioDia,
  ItemAgendaProfesional,
  Jornada,
  JornadaDelDia,
  LlegadaRegistrada,
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
   * Que servicios y que consultorios atendieron UN DIA concreto.
   *
   * La misma idea que `jornadasDelDia`, para el resto del catalogo: el campo
   * `activo` dice que algo existe en el hospital, no que hoy este funcionando,
   * y las pantallas de administracion necesitan poder distinguirlo para
   * cualquier dia, no solo para hoy.
   */
  actividadDelCatalogo(fecha: string): Promise<ActividadCatalogo>

  /**
   * TEMPORAL (solo pruebas): borra las citas y los turnos de hoy para que el
   * panel de simulacion de carga pueda arrancar de cero. Sin esto, las citas
   * ya usadas quedan como PRESENTADO/ATENDIDA y la siguiente corrida se queda
   * sin pacientes (y ademas topa el maximo de citas por profesional).
   */
  reiniciarDatosDeHoy(): Promise<void>

  /**
   * TEMPORAL (solo pruebas): si HOY no hay citas, pasa a hoy las del ultimo dia
   * que tenga, a la misma hora y como PROGRAMADA. No crea ninguna cita: la
   * simulacion de carga reusa las que ya existen. Devuelve de que dia vinieron
   * y cuantas eran (`desde: null` si no hay ninguna en dias anteriores).
   */
  traerCitasDelUltimoDia(hoy: string, excluirProfesionales?: string[]): Promise<{ desde: string | null; movidas: number }>

  /**
   * TEMPORAL (solo pruebas): borra los consultorios que la simulacion crea
   * para poder mostrar mas consultorios de los que hay (los que empiezan por
   * `prefijo`). Devuelve cuantos borro.
   */
  eliminarConsultoriosDeSimulacion(prefijo: string): Promise<number>

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
   *
   * IDEMPOTENTE. Si la cita ya registro su llegada hoy, devuelve el turno que
   * genero (`yaRegistrada: true`) en vez de fallar: con la red lenta la
   * respuesta de la primera vez se pierde, y sin esto admisiones nunca veia el
   * comprobante que tiene que dictarle al paciente. Dos registros simultaneos
   * de la misma cita generan un solo turno.
   */
  registrarLlegada(citaId: string): Promise<LlegadaRegistrada>
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
   * Si el turno es de una fila COMPARTIDA y lo llamo ese funcionario. Es lo que
   * impide que una cuenta con la seccion del operador cierre o repita, por id,
   * el turno de un doctor o el de otra ventanilla.
   */
  turnoEsDeLaVentanilla(turnoId: string, funcionarioId: string): Promise<boolean>
  /**
   * El turno abierto (LLAMADO o EN_ATENCION) de ese dia que cumple el filtro,
   * el ultimo llamado si hubiera varios, o null.
   *
   * Con `profesionalId` es el paciente que el doctor tiene al frente; con
   * `moduloId` + `funcionarioId`, el de esa ventanilla. Es lo que deja a la
   * pantalla recuperarlo si se perdio la respuesta del llamado o se recargo la
   * pagina, en vez de que el siguiente llamado lo cierre solo.
   */
  turnoAbierto(filtro: FiltroTurnoAbierto, fecha: string): Promise<Turno | null>
  /**
   * Llama el siguiente turno y lo asigna a un modulo (seccion 9), cerrando el
   * anterior de quien llama (ver `alcanceDelLlamado`).
   *
   * `turnoAbiertoEsperado` es el turno que la pantalla cree tener abierto (null
   * si ninguno). Si el real es otro, lanza `ConflictoDeTurno` (409) con el real
   * y no toca nada: es el doble clic o el reintento tras una respuesta perdida.
   * El modulo ocupado por otra persona tambien es 409. Una ventanilla solo
   * puede llamar filas compartidas desde un modulo compatible.
   *
   * Reclamar, cerrar el anterior y marcar el llamado van en una sola operacion
   * atomica; el aviso a la pantalla se publica despues, y si falla no deshace
   * el llamado.
   */
  llamarSiguiente(params: PeticionDeLlamado): Promise<Turno | null>
  /**
   * Repite el llamado, incrementando el contador (seccion 12).
   *
   * `vecesLlamadoVisto` es el conteo que tenia la pantalla: si el servidor ya
   * va por delante, la repeticion ya se hizo y no vuelve a sonar.
   */
  repetirLlamado(turnoId: string, opciones?: { vecesLlamadoVisto?: number }): Promise<AccionSobreTurno>
  /**
   * Cierra el turno. `cerradoPor` es quien lo cierra (usuario del sistema, o el
   * id del profesional cuando entra por su enlace): sin el no se podia
   * responder quien dio por atendido o por ausente a un paciente.
   *
   * Condicionado al estado e idempotente: si ya esta en el estado pedido,
   * responde `yaAplicada`; si se cerro de otra forma, `ConflictoDeTurno`. El
   * turno y su cita cambian en la misma operacion atomica.
   */
  marcarAtendido(turnoId: string, cerradoPor?: string): Promise<AccionSobreTurno>
  marcarAusente(turnoId: string, cerradoPor?: string): Promise<AccionSobreTurno>
  /**
   * Lo que haria HOY el boton "Retroceder" del doctor (ver
   * `reglas-retroceso.ts`), o null si no hay nada que retroceder. La pantalla
   * lo muestra antes de confirmar: "vuelve C-010, Ana Ortega".
   */
  planDeRetroceso(profesionalId: string): Promise<PlanDeRetroceso | null>
  /**
   * Retrocede al turno anterior en una sola operacion atomica: el paciente
   * abierto vuelve a la fila de espera (a su mismo puesto) y el anterior, si
   * ese llamado lo habia cerrado, vuelve a quedar en atencion.
   *
   * `visto` es lo que la pantalla mostraba: si el plan real es otro (el doble
   * clic, o un cambio desde otro equipo), lanza `ConflictoDeTurno` (409) y no
   * toca nada. Serializado con los llamados del mismo doctor. El televisor se
   * entera despues, sin campana (evento `turno.devuelto`). Devuelve los dos
   * turnos ya cambiados.
   */
  retrocederTurno(
    profesionalId: string,
    visto: { turnoAbiertoId: string | null; restaurarId: string | null },
  ): Promise<PlanDeRetroceso>

  // --- Pantalla de la sala de espera (seccion 10) ---
  /**
   * Estado completo de la pantalla: una casilla por consultorio o ventanilla
   * activa, con el turno que esta atendiendo, mas la configuracion con la que
   * se pinta y se suena. Ya viene enmascarado, porque la pantalla no tiene
   * sesion.
   */
  estadoPantalla(): Promise<EstadoPantalla>

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
  configuracion(): Promise<ConfiguracionGuardada>
  /**
   * Guarda los parametros generales.
   *
   * `visto` es la marca `actualizadoEn` que tenia la configuracion cuando el
   * administrador abrio la pantalla. Si ya no coincide, alguien guardo en
   * medio y la escritura se rechaza en vez de revertirle el cambio al otro.
   * Es opcional para los usos sin pantalla (siembra, scripts), que no compiten
   * con nadie.
   */
  guardarConfiguracion(
    datos: Partial<ConfiguracionSistema>,
    opciones?: { visto?: string },
  ): Promise<ConfiguracionGuardada>

  // --- Acceso temporal de profesionales (enlace de 24h, sin usuario/clave) ---
  /**
   * Genera un enlace nuevo para el profesional, vigente por `duracionMinutos`
   * desde ahora (el hospital tiene turnos de manana, tarde y noche: la
   * vigencia la elige el administrador, no es fija). Revoca cualquier acceso
   * vigente que tuviera: un doctor, un enlace activo a la vez, y la copia
   * cifrada del anterior se borra en la misma operacion.
   *
   * Lo que valida la entrada sigue siendo el hash. Ademas se guarda una copia
   * CIFRADA del token para poder volver a mostrarlo mientras esta vigente (ver
   * `tokenVigenteDeProfesional`).
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
  /**
   * Cuando vence el enlace de este token (ISO), o `null` si no existe o fue
   * revocado. Solo lee: no apunta uso ni limpia nada.
   */
  expiracionDelAcceso(token: string): Promise<string | null>
  /**
   * El token EN CLARO del enlace vigente de un doctor, o `null` si no tiene
   * ninguno vivo (o si su copia cifrada ya no se puede leer).
   *
   * EXISTE PARA NO TENER QUE REGENERAR. En el mostrador se pierde el mensaje
   * con el enlace, o lo genero otro equipo, y hasta ahora la unica salida era
   * crear uno nuevo: eso revoca el anterior y expulsa al doctor que en ese
   * momento esta llamando pacientes.
   *
   * NUNCA devuelve el token de un acceso revocado o vencido, y de paso limpia
   * la copia cifrada del que encuentre vencido: la tabla no tiene por que
   * seguir guardando una llave que ya no abre nada.
   */
  tokenVigenteDeProfesional(profesionalId: string): Promise<string | null>
  listarAccesosProfesional(): Promise<AccesoProfesional[]>
  /** Revoca el acceso y borra su copia cifrada: deja de poder mostrarse. */
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

/**
 * Cada cuanto se apunta el `ultimoUsoEn` de un enlace de consultorio.
 *
 * Se escribia en cada peticion del doctor, y su pantalla recarga con cada
 * evento del hospital: una escritura en la base por recarga y por consultorio
 * para un dato que la pantalla de enlaces muestra con precision de minutos.
 * Las dos implementaciones espacian igual.
 */
export const MS_ENTRE_APUNTES_DE_USO = 5 * 60 * 1000
export const MINUTOS_ACCESO_MAXIMO = 72 * 60

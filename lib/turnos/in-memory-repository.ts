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
import type { TurnoRepository } from './repository'
import type {
  AccesoProfesional,
  CasillaPantalla,
  Cita,
  ConfiguracionPantalla,
  EstadisticasDia,
  EstadisticasServicio,
  EstadoAgendaItem,
  FiltroHistorico,
  ItemAgendaProfesional,
  Modulo,
  Profesional,
  Servicio,
  Turno,
} from './types'
import { enmascararNombre } from './privacidad'
import { errorDeNegocio } from './errores'
import { realtimeHub } from '@/lib/realtime/hub'

/**
 * Rango permitido para la vigencia del enlace temporal del profesional (RF
 * pendiente, confirmado por el hospital). El minimo evita enlaces
 * inservibles por error de dedo; el maximo evita dejar una llave viva
 * indefinidamente, que es el riesgo real de este mecanismo.
 */
export const MINUTOS_ACCESO_MINIMO = 15
export const MINUTOS_ACCESO_MAXIMO = 72 * 60

interface EstadoMemoria {
  servicios: Servicio[]
  modulos: Modulo[]
  profesionales: Profesional[]
  citas: Cita[]
  turnos: Turno[]
  contadores: Record<string, number>
  configuracion: ConfiguracionPantalla
  /**
   * Solo se guarda el hash del token, nunca el token en claro (seccion 17:
   * minimizar datos sensibles; un enlace filtrado del estado no sirve para
   * entrar).
   */
  accesosProfesional: Array<AccesoProfesional & { tokenHash: string }>
}

const CONFIGURACION_INICIAL: ConfiguracionPantalla = {
  audioActivo: true,
  repeticionesAudio: 2,
  volumen: 1,
  ultimosVisibles: 5,
  mensajePie: 'Bienvenido a la ESE Hospital San Rafael de Chinu. Por favor espere a ser llamado.',
  maxCitasPorProfesional: 20,
}

function crearId() {
  return Math.random().toString(36).slice(2, 10)
}

function ahoraISO() {
  return new Date().toISOString()
}

/**
 * Dia (AAAA-MM-DD) de un instante ISO, en hora de Colombia.
 *
 * Las fechas se guardan en UTC (`toISOString()`), pero el hospital y la UI
 * razonan en hora local (America/Bogota, UTC-5). Recortar el ISO directamente
 * daria el dia UTC: despues de las 7 p. m. en Colombia el dia UTC ya es el
 * siguiente, y el historico/estadisticas de "hoy" saldrian en cero. Comparar
 * por este dia local evita ese desfase.
 */
function diaColombia(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(iso))
}

function horaDeHoy(hora: number, minuto: number) {
  const fecha = new Date()
  fecha.setHours(hora, minuto, 0, 0)
  return fecha.toISOString()
}

function sembrar(): EstadoMemoria {
  const servicios: Servicio[] = [
    { id: 'srv-admisiones', nombre: 'Admisiones', prefijo: 'A', modoFila: 'COMPARTIDA', activo: true },
    { id: 'srv-facturacion', nombre: 'Facturacion', prefijo: 'F', modoFila: 'COMPARTIDA', activo: true },
    { id: 'srv-siau', nombre: 'SIAU', prefijo: 'S', modoFila: 'COMPARTIDA', activo: true },
    { id: 'srv-consulta-externa', nombre: 'Consulta externa', prefijo: 'C', modoFila: 'POR_PROFESIONAL', activo: true },
    { id: 'srv-odontologia', nombre: 'Odontologia', prefijo: 'O', modoFila: 'POR_PROFESIONAL', activo: true },
    { id: 'srv-pediatria', nombre: 'Pediatria', prefijo: 'P', modoFila: 'POR_PROFESIONAL', activo: true },
  ]

  const modulos: Modulo[] = [
    { id: 'mod-ventanilla-1', nombre: 'Ventanilla 1', servicioId: null, activo: true },
    { id: 'mod-ventanilla-2', nombre: 'Ventanilla 2', servicioId: null, activo: true },
    { id: 'mod-ventanilla-3', nombre: 'Ventanilla 3', servicioId: null, activo: true },
    { id: 'mod-consultorio-1', nombre: 'Consultorio 1', servicioId: 'srv-consulta-externa', activo: true },
    { id: 'mod-consultorio-2', nombre: 'Consultorio 2', servicioId: 'srv-consulta-externa', activo: true },
    { id: 'mod-consultorio-3', nombre: 'Consultorio 3', servicioId: 'srv-odontologia', activo: true },
    { id: 'mod-consultorio-4', nombre: 'Consultorio 4', servicioId: 'srv-pediatria', activo: true },
  ]

  const profesionales: Profesional[] = [
    { id: 'pro-perez', nombre: 'Dr. Perez', servicioId: 'srv-consulta-externa', moduloId: 'mod-consultorio-1', activo: true },
    { id: 'pro-gomez', nombre: 'Dra. Gomez', servicioId: 'srv-consulta-externa', moduloId: 'mod-consultorio-2', activo: true },
    { id: 'pro-salas', nombre: 'Dr. Salas', servicioId: 'srv-odontologia', moduloId: 'mod-consultorio-3', activo: true },
    { id: 'pro-rios', nombre: 'Dra. Rios', servicioId: 'srv-pediatria', moduloId: 'mod-consultorio-4', activo: true },
  ]

  // Citas de ejemplo. En produccion vienen de la API del hospital.
  const agenda: Array<[string, string, string, number, number]> = [
    ['1067890123', 'Juan Carlos Perez Gomez', 'pro-perez', 8, 0],
    ['1067890124', 'Maria Fernanda Lopez Diaz', 'pro-perez', 8, 20],
    ['1067890125', 'Pedro Antonio Ruiz Mora', 'pro-perez', 8, 40],
    ['1067890126', 'Ana Lucia Martinez Vega', 'pro-gomez', 8, 0],
    ['1067890127', 'Carlos Andres Herrera Sosa', 'pro-gomez', 8, 30],
    ['1067890128', 'Luisa Fernanda Castro Niño', 'pro-salas', 9, 0],
    ['1067890129', 'Jorge Eliecer Pacheco Luna', 'pro-salas', 9, 30],
    ['1067890130', 'Sofia Alejandra Nuñez Paz', 'pro-rios', 8, 15],
    ['1067890131', 'Miguel Angel Duran Rojas', 'pro-rios', 8, 45],
  ]

  const citas: Cita[] = agenda.map(([documento, nombre, profesionalId, hora, minuto]) => ({
    id: crearId(),
    documentoPaciente: documento,
    nombrePaciente: nombre,
    profesionalId,
    servicioId: profesionales.find((p) => p.id === profesionalId)!.servicioId,
    horaCita: horaDeHoy(hora, minuto),
    estado: 'PROGRAMADA',
  }))

  return {
    servicios,
    modulos,
    profesionales,
    citas,
    turnos: [],
    contadores: {},
    configuracion: { ...CONFIGURACION_INICIAL },
    accesosProfesional: [],
  }
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
const VERSION_ESTADO = 6

declare global {
  var __turnosMemoria: (EstadoMemoria & { version: number }) | undefined
}

const guardado = globalThis.__turnosMemoria
const estado: EstadoMemoria & { version: number } =
  guardado?.version === VERSION_ESTADO ? guardado : { ...sembrar(), version: VERSION_ESTADO }

if (process.env.NODE_ENV !== 'production') {
  globalThis.__turnosMemoria = estado
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

function siguienteCodigo(servicio: Servicio) {
  estado.contadores[servicio.prefijo] = (estado.contadores[servicio.prefijo] ?? 0) + 1
  return `${servicio.prefijo}-${String(estado.contadores[servicio.prefijo]).padStart(3, '0')}`
}

function ordenAtencion(a: Turno, b: Turno) {
  if (a.prioridad !== b.prioridad) return a.prioridad === 'PRIORITARIO' ? -1 : 1
  return new Date(a.fechaGeneracion).getTime() - new Date(b.fechaGeneracion).getTime()
}

/** Arma la casilla que ve la pantalla publica, con el nombre ya enmascarado. */
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
    turnoId: turno.id,
    codigo: turno.codigo,
    pacienteVisible: enmascararNombre(turno.nombrePaciente),
    horaLlamado: turno.horaLlamado ?? null,
    vecesLlamado: turno.vecesLlamado,
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
  }
}

export class InMemoryTurnoRepository implements TurnoRepository {
  // --- Catalogos ---

  async listarServicios(): Promise<Servicio[]> {
    return estado.servicios.filter((s) => s.activo)
  }

  async listarModulos(servicioId?: string): Promise<Modulo[]> {
    return estado.modulos.filter(
      (m) => m.activo && (!servicioId || !m.servicioId || m.servicioId === servicioId),
    )
  }

  async listarProfesionales(servicioId?: string): Promise<Profesional[]> {
    return estado.profesionales.filter((p) => p.activo && (!servicioId || p.servicioId === servicioId))
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
  }): Promise<Cita> {
    const profesional = estado.profesionales.find((p) => p.id === datos.profesionalId)
    if (!profesional) errorDeNegocio('El profesional indicado no existe.')
    if (!profesional.activo) errorDeNegocio('El profesional esta inactivo.')

    const documento = datos.documentoPaciente.trim()
    const nombre = datos.nombrePaciente.trim()
    if (!documento) errorDeNegocio('Ingresa el documento del paciente.')
    if (!nombre) errorDeNegocio('Ingresa el nombre del paciente.')
    if (Number.isNaN(new Date(datos.horaCita).getTime())) errorDeNegocio('La hora de la cita no es valida.')

    // Tope de citas por profesional en el dia de la cita (lo fija el
    // administrador). 0 = sin limite.
    const tope = estado.configuracion.maxCitasPorProfesional
    if (tope > 0) {
      const dia = diaColombia(datos.horaCita)
      const agendadas = estado.citas.filter(
        (c) => c.profesionalId === profesional.id && c.estado !== 'CANCELADA' && diaColombia(c.horaCita) === dia,
      ).length
      if (agendadas >= tope) {
        errorDeNegocio(`${profesional.nombre} ya tiene el maximo de ${tope} citas para ese dia.`)
      }
    }

    const cita: Cita = {
      id: crearId(),
      documentoPaciente: documento,
      nombrePaciente: nombre,
      profesionalId: profesional.id,
      servicioId: profesional.servicioId,
      horaCita: datos.horaCita,
      estado: 'PROGRAMADA',
    }

    estado.citas.push(cita)
    return cita
  }

  async cancelarCita(citaId: string): Promise<Cita> {
    const cita = estado.citas.find((c) => c.id === citaId)
    if (!cita) errorDeNegocio('La cita indicada no existe.')
    // Si el paciente ya llego, cancelarla dejaria un turno huerfano en la fila.
    if (cita.estado === 'PRESENTADO') errorDeNegocio('El paciente ya registro su llegada; no se puede cancelar.')
    cita.estado = 'CANCELADA'
    return cita
  }

  // --- Admisiones ---

  async buscarCitasPorDocumento(documento: string): Promise<Cita[]> {
    const buscado = documento.trim()
    if (!buscado) return []
    return estado.citas.filter((c) => c.documentoPaciente === buscado && c.estado !== 'CANCELADA')
  }

  async registrarLlegada(citaId: string): Promise<Turno> {
    const cita = estado.citas.find((c) => c.id === citaId)
    if (!cita) errorDeNegocio('La cita indicada no existe.')
    if (cita.estado === 'CANCELADA') errorDeNegocio('La cita fue cancelada.')
    if (cita.estado !== 'PROGRAMADA') errorDeNegocio('Esta cita ya registro la llegada del paciente.')

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
    return estado.turnos
      .filter((t) => {
        if (t.estado !== 'EN_ESPERA') return false
        if (filtro.profesionalId && t.profesionalId !== filtro.profesionalId) return false
        if (filtro.servicioId && t.servicioId !== filtro.servicioId) return false
        return true
      })
      .sort(ordenAtencion)
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

    const pendientes = await this.listarPendientes({
      servicioId: params.servicioId,
      profesionalId: params.profesionalId,
    })
    const siguiente = pendientes[0]
    if (!siguiente) return null

    // Un consultorio atiende a un paciente a la vez: al llamar el siguiente, el
    // anterior de ese mismo modulo se da por atendido.
    cerrarAtencionAbierta(modulo.id, siguiente.id)

    siguiente.estado = 'LLAMADO'
    siguiente.moduloId = modulo.id
    siguiente.funcionarioId = params.funcionarioId
    siguiente.horaLlamado = ahoraISO()
    siguiente.vecesLlamado += 1

    realtimeHub.publish({ tipo: 'turno.llamado', casilla: casillaDeTurno(siguiente), repetido: false })

    return siguiente
  }

  async repetirLlamado(turnoId: string): Promise<Turno> {
    const turno = buscarTurno(turnoId)
    if (!turno.moduloId) errorDeNegocio('El turno no ha sido llamado todavia.')

    turno.vecesLlamado += 1
    turno.horaLlamado = ahoraISO()

    realtimeHub.publish({ tipo: 'turno.llamado', casilla: casillaDeTurno(turno), repetido: true })

    return turno
  }

  async marcarAtendido(turnoId: string): Promise<Turno> {
    const turno = buscarTurno(turnoId)
    turno.estado = 'ATENDIDO'
    turno.horaAtencion = ahoraISO()

    if (turno.citaId) {
      const cita = estado.citas.find((c) => c.id === turno.citaId)
      if (cita) cita.estado = 'ATENDIDA'
    }

    if (turno.moduloId) realtimeHub.publish({ tipo: 'modulo.liberado', moduloId: turno.moduloId })
    return turno
  }

  async marcarAusente(turnoId: string): Promise<Turno> {
    const turno = buscarTurno(turnoId)
    turno.estado = 'AUSENTE'

    if (turno.moduloId) realtimeHub.publish({ tipo: 'modulo.liberado', moduloId: turno.moduloId })
    return turno
  }

  // --- Pantalla de la sala de espera ---

  async estadoPantalla(): Promise<CasillaPantalla[]> {
    const enAtencion = estado.turnos.filter(
      (t) => t.moduloId && (t.estado === 'LLAMADO' || t.estado === 'EN_ATENCION'),
    )

    return estado.modulos
      .filter((m) => m.activo)
      .map((modulo) => {
        const turno = enAtencion
          .filter((t) => t.moduloId === modulo.id)
          .sort((a, b) => new Date(b.horaLlamado ?? 0).getTime() - new Date(a.horaLlamado ?? 0).getTime())[0]

        if (turno) return casillaDeTurno(turno)

        const servicio = modulo.servicioId ? buscarServicio(modulo.servicioId) : null
        const profesional = estado.profesionales.find((p) => p.moduloId === modulo.id)

        return {
          moduloId: modulo.id,
          moduloNombre: modulo.nombre,
          servicioId: servicio?.id ?? '',
          servicioNombre: servicio?.nombre ?? 'Ventanilla',
          profesionalNombre: profesional?.nombre ?? null,
          turnoId: null,
          codigo: null,
          pacienteVisible: null,
          horaLlamado: null,
          vecesLlamado: 0,
        }
      })
  }

  /**
   * Ultimos turnos llamados, en orden descendente. Alimenta la lista lateral
   * de la pantalla; util cuando varios consultorios llaman casi al tiempo y el
   * destacado principal alcanza a rotar antes de que el paciente lo vea.
   */
  async ultimosLlamados(limite = 5): Promise<CasillaPantalla[]> {
    return estado.turnos
      .filter((t) => t.horaLlamado && t.moduloId)
      .sort((a, b) => new Date(b.horaLlamado!).getTime() - new Date(a.horaLlamado!).getTime())
      .slice(0, limite)
      .map(casillaDeTurno)
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
        return true
      })
      .sort((a, b) => new Date(b.fechaGeneracion).getTime() - new Date(a.fechaGeneracion).getTime())
  }

  async estadisticas(fecha: string): Promise<EstadisticasDia> {
    const delDia = estado.turnos.filter((t) => diaColombia(t.fechaGeneracion) === fecha)

    const porFuncionario = new Map<string, number>()
    for (const turno of delDia) {
      if (turno.estado !== 'ATENDIDO' || !turno.funcionarioId) continue
      porFuncionario.set(turno.funcionarioId, (porFuncionario.get(turno.funcionarioId) ?? 0) + 1)
    }

    return {
      fecha,
      total: resumir('', 'Todos los servicios', delDia),
      porServicio: estado.servicios.map((servicio) =>
        resumir(servicio.id, servicio.nombre, delDia.filter((t) => t.servicioId === servicio.id)),
      ),
      porFuncionario: [...porFuncionario.entries()]
        .map(([funcionarioId, atendidos]) => ({ funcionarioId, atendidos }))
        .sort((a, b) => b.atendidos - a.atendidos),
    }
  }

  // --- Administracion de catalogos ---

  async crearServicio(datos: Omit<Servicio, 'id'>): Promise<Servicio> {
    validarPrefijoLibre(datos.prefijo)
    const servicio: Servicio = { ...datos, prefijo: datos.prefijo.toUpperCase(), id: `srv-${crearId()}` }
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
    if (datos.nombre !== undefined) servicio.nombre = datos.nombre
    if (datos.modoFila !== undefined) servicio.modoFila = datos.modoFila
    if (datos.activo !== undefined) servicio.activo = datos.activo
    return servicio
  }

  async crearModulo(datos: Omit<Modulo, 'id'>): Promise<Modulo> {
    if (datos.servicioId) buscarServicio(datos.servicioId)
    const modulo: Modulo = { ...datos, id: `mod-${crearId()}` }
    estado.modulos.push(modulo)
    return modulo
  }

  async actualizarModulo(id: string, datos: Partial<Omit<Modulo, 'id'>>): Promise<Modulo> {
    const modulo = buscarModulo(id)
    if (datos.servicioId) buscarServicio(datos.servicioId)
    if (datos.nombre !== undefined) modulo.nombre = datos.nombre
    if (datos.servicioId !== undefined) modulo.servicioId = datos.servicioId || null
    if (datos.activo !== undefined) modulo.activo = datos.activo
    return modulo
  }

  // --- Parametros generales ---

  async configuracion(): Promise<ConfiguracionPantalla> {
    return { ...estado.configuracion }
  }

  async guardarConfiguracion(datos: Partial<ConfiguracionPantalla>): Promise<ConfiguracionPantalla> {
    estado.configuracion = { ...estado.configuracion, ...datos }
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

  async listarAccesosProfesional(): Promise<AccesoProfesional[]> {
    return estado.accesosProfesional
      .map(({ tokenHash: _tokenHash, ...acceso }) => acceso)
      .sort((a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime())
  }

  async revocarAccesoProfesional(id: string): Promise<AccesoProfesional> {
    const acceso = estado.accesosProfesional.find((a) => a.id === id)
    if (!acceso) errorDeNegocio('El acceso indicado no existe.')
    if (!acceso.revocadoEn) acceso.revocadoEn = ahoraISO()

    const { tokenHash: _tokenHash, ...accesoPublico } = acceso
    return accesoPublico
  }
}

function validarPrefijoLibre(prefijo: string) {
  const normalizado = prefijo.trim().toUpperCase()
  if (!normalizado) errorDeNegocio('El prefijo es obligatorio.')
  if (estado.servicios.some((s) => s.prefijo === normalizado)) {
    errorDeNegocio(`El prefijo ${normalizado} ya lo usa otro servicio.`)
  }
}

function promedioMinutos(valores: number[]): number | null {
  if (valores.length === 0) return null
  const total = valores.reduce((suma, valor) => suma + valor, 0)
  return Math.round((total / valores.length / 60000) * 10) / 10
}

function resumir(servicioId: string, servicioNombre: string, turnos: Turno[]): EstadisticasServicio {
  const esperas: number[] = []
  const atenciones: number[] = []

  for (const turno of turnos) {
    if (turno.horaLlamado) {
      esperas.push(new Date(turno.horaLlamado).getTime() - new Date(turno.fechaGeneracion).getTime())
    }
    if (turno.horaLlamado && turno.horaAtencion) {
      atenciones.push(new Date(turno.horaAtencion).getTime() - new Date(turno.horaLlamado).getTime())
    }
  }

  return {
    servicioId,
    servicioNombre,
    generados: turnos.length,
    atendidos: turnos.filter((t) => t.estado === 'ATENDIDO').length,
    ausentes: turnos.filter((t) => t.estado === 'AUSENTE').length,
    pendientes: turnos.filter((t) => t.estado === 'EN_ESPERA').length,
    minutosEsperaPromedio: promedioMinutos(esperas),
    minutosAtencionPromedio: promedioMinutos(atenciones),
  }
}

/**
 * Cierra la atencion que siguiera abierta en un modulo.
 *
 * Cuando el profesional pulsa "siguiente" esta diciendo, implicitamente, que
 * termino con el anterior (seccion 22, pasos 9 y 10).
 */
function cerrarAtencionAbierta(moduloId: string, exceptoTurnoId: string) {
  for (const turno of estado.turnos) {
    if (turno.moduloId !== moduloId) continue
    if (turno.id === exceptoTurnoId) continue
    if (turno.estado !== 'LLAMADO' && turno.estado !== 'EN_ATENCION') continue

    turno.estado = 'ATENDIDO'
    turno.horaAtencion = ahoraISO()

    if (turno.citaId) {
      const cita = estado.citas.find((c) => c.id === turno.citaId)
      if (cita) cita.estado = 'ATENDIDA'
    }
  }
}

export const turnoRepository: InMemoryTurnoRepository = new InMemoryTurnoRepository()

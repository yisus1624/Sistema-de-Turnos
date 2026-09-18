// Flujo completo acordado con el hospital:
// cita -> registro de llegada -> turno en espera -> llamado (seccion 9) ->
// repetir (seccion 12) -> atendido / ausente (seccion 8).
import assert from 'node:assert/strict'
import test from 'node:test'

const { InMemoryTurnoRepository } = await import('@/lib/turnos/in-memory-repository')
const { realtimeHub } = await import('@/lib/realtime/hub')

const repo = new InMemoryTurnoRepository()


/**
 * Crea un servicio de ventanilla propio, con su modulo.
 *
 * El catalogo de ejemplo ya no trae ventanillas (el hospital atiende todo por
 * cita), pero el sistema sigue soportando la fila compartida por orden de
 * llegada y hay que seguir cubriendola. Cada prueba pide la suya para no
 * heredar los turnos que dejo la anterior en la misma fila.
 */
let ventanillasCreadas = 0
async function ventanillaPropia() {
  ventanillasCreadas += 1
  const sufijo = String.fromCharCode(64 + ventanillasCreadas) // A, B, C...
  const servicio = await repo.crearServicio({
    nombre: `Ventanilla de prueba ${sufijo}`,
    prefijo: `V${sufijo}`,
    modoFila: 'COMPARTIDA',
    activo: true,
  })
  const modulo = await repo.crearModulo({
    nombre: `Ventanilla ${sufijo}`,
    servicioId: servicio.id,
    activo: true,
  })
  return { servicio, modulo }
}

/** Dia de hoy en Colombia, que es como razona la aplicacion. */
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())

/**
 * Toma una cita de hoy de ese doctor que todavia no se ha usado.
 *
 * Se busca POR DOCTOR y no por documento a proposito: las citas de ejemplo se
 * colocan en las franjas de la jornada de cada doctor, asi que que documento le
 * toca a quien depende de la duracion de la consulta y del horario configurado.
 * Atar estas pruebas a un documento concreto las rompe cada vez que cambia la
 * agenda de ejemplo, por motivos que no tienen nada que ver con el flujo del
 * turno, que es lo que se esta probando aqui.
 */
async function citaLibre(profesionalId) {
  const agenda = await repo.agendaProfesional(profesionalId, HOY)
  const item = agenda.find((i) => i.estado === 'PROGRAMADA')
  assert.ok(item, `no hay cita PROGRAMADA de hoy para ${profesionalId}`)

  return {
    id: item.citaId,
    profesionalId,
    documentoPaciente: item.documentoPaciente,
    nombrePaciente: item.nombrePaciente,
    fecha: HOY,
  }
}

test('el turno de ventanilla usa el prefijo del servicio (RF-002)', async () => {
  const { servicio } = await ventanillaPropia()

  const turno = await repo.generarTurnoDeVentanilla(servicio.id)
  assert.match(turno.codigo, new RegExp(`^${servicio.prefijo}-\\d{3}$`))
  assert.equal(turno.estado, 'EN_ESPERA')
  assert.equal(turno.vecesLlamado, 0)
  assert.equal(turno.profesionalId, null)
})

test('un servicio con cita no permite generar turnos de ventanilla', async () => {
  await assert.rejects(() => repo.generarTurnoDeVentanilla('srv-consulta-externa'), /por cita/i)
})

test('registrar la llegada convierte la cita en turno del profesional', async () => {
  const cita = await citaLibre('pro-perez')
  const turno = await repo.registrarLlegada(cita.id)

  assert.equal(turno.estado, 'EN_ESPERA')
  assert.equal(turno.profesionalId, cita.profesionalId)
  assert.equal(turno.citaId, cita.id)
  assert.equal(turno.nombrePaciente, cita.nombrePaciente)
  assert.match(turno.codigo, /^C-\d{3}$/)

  const [actualizada] = await repo.buscarCitasPorDocumento(cita.documentoPaciente)
  assert.equal(actualizada.estado, 'PRESENTADO')
})

test('no se puede registrar dos veces la llegada de la misma cita', async () => {
  const cita = await citaLibre('pro-perez')
  await repo.registrarLlegada(cita.id)
  await assert.rejects(() => repo.registrarLlegada(cita.id), /ya registro/i)
})

test('cada profesional solo ve sus propios pacientes', async () => {
  const suya = await citaLibre('pro-gomez')
  await repo.registrarLlegada(suya.id)

  const pendientesGomez = await repo.listarPendientes({ profesionalId: 'pro-gomez' })
  const pendientesPerez = await repo.listarPendientes({ profesionalId: 'pro-perez' })

  assert.ok(pendientesGomez.every((t) => t.profesionalId === 'pro-gomez'))
  assert.ok(pendientesPerez.every((t) => t.profesionalId === 'pro-perez'))
  assert.equal(pendientesGomez.some((t) => t.citaId === suya.id), true)
  assert.equal(pendientesPerez.some((t) => t.citaId === suya.id), false)
})

test('a la pantalla publica no viaja ningun dato del paciente', async () => {
  const cita = await citaLibre('pro-salas') // odontologia
  await repo.registrarLlegada(cita.id)

  const eventos = []
  const desuscribir = realtimeHub.subscribe((evento) => eventos.push(evento))

  const llamado = await repo.llamarSiguiente({
    profesionalId: 'pro-salas',
    moduloId: 'mod-consultorio-9',
    funcionarioId: 'usuario-prueba',
  })
  desuscribir()

  assert.ok(llamado)
  assert.equal(llamado.estado, 'LLAMADO')
  assert.equal(llamado.moduloId, 'mod-consultorio-9')
  assert.equal(llamado.funcionarioId, 'usuario-prueba')
  assert.equal(llamado.vecesLlamado, 1)

  const evento = eventos.find((e) => e.tipo === 'turno.llamado')
  assert.ok(evento, 'debe publicarse el evento turno.llamado')

  // Lo que si va: a donde tiene que entrar el paciente y quien lo atiende.
  assert.equal(evento.casilla.moduloNombre, 'Consultorio 9')
  assert.equal(evento.casilla.profesionalNombre, 'Dr. Salas')
  assert.equal(evento.casilla.codigo, llamado.codigo)

  // Lo que no: nada del paciente. La pantalla no tiene sesion y la ve todo el
  // que pase por el pasillo, asi que ni el nombre completo ni una version
  // abreviada pueden salir hacia alla.
  const serializado = JSON.stringify(evento)
  assert.equal(
    serializado.includes(cita.nombrePaciente),
    false,
    'el nombre del paciente no puede viajar a la pantalla publica',
  )
  assert.equal(
    serializado.includes(cita.nombrePaciente.split(' ')[0]),
    false,
    'ni siquiera el primer nombre del paciente',
  )
  assert.equal(
    serializado.includes(cita.documentoPaciente),
    false,
    'ni su documento',
  )
})

test('el estado completo de la pantalla tampoco lleva datos de pacientes', async () => {
  const cita = await citaLibre('pro-torres')
  await repo.registrarLlegada(cita.id)
  const llamado = await repo.llamarSiguiente({
    profesionalId: 'pro-torres',
    moduloId: 'mod-consultorio-5',
    funcionarioId: 'usuario-prueba',
  })

  const serializado = JSON.stringify(await repo.estadoPantalla())
  assert.equal(serializado.includes(cita.nombrePaciente), false)
  assert.equal(serializado.includes(cita.documentoPaciente), false)
  // Pero el turno si esta: es con lo que el paciente se reconoce.
  assert.ok(serializado.includes(llamado.codigo))
})

test('admisiones si recibe el turno, el consultorio y el doctor para dictarselos al paciente', async () => {
  const cita = await citaLibre('pro-mejia')
  const turno = await repo.registrarLlegada(cita.id)

  const comprobante = await repo.comprobanteDeLlegada(turno.id)

  assert.equal(comprobante.codigo, turno.codigo)
  assert.equal(comprobante.profesionalNombre, 'Dra. Mejia')
  // El consultorio habitual del doctor: el turno todavia no tiene modulo
  // asignado porque nadie lo ha llamado, y aun asi hay que orientar al
  // paciente en el mostrador.
  assert.equal(comprobante.moduloNombre, 'Consultorio 6')
  assert.equal(comprobante.servicioNombre, 'Consulta externa')
  assert.equal(comprobante.nombrePaciente, cita.nombrePaciente)
})

test('repetir el llamado incrementa el contador (seccion 12)', async () => {
  const cita = await citaLibre('pro-rios')
  await repo.registrarLlegada(cita.id)

  const llamado = await repo.llamarSiguiente({
    profesionalId: 'pro-rios',
    moduloId: 'mod-consultorio-3',
    funcionarioId: 'usuario-prueba',
  })

  const repetido = await repo.repetirLlamado(llamado.id)
  assert.equal(repetido.vecesLlamado, 2)
  assert.equal(repetido.estado, 'LLAMADO')
})

test('no se puede repetir un turno que aun no fue llamado', async () => {
  const { servicio } = await ventanillaPropia()
  const turno = await repo.generarTurnoDeVentanilla(servicio.id)
  await assert.rejects(() => repo.repetirLlamado(turno.id), /no ha sido llamado/i)
})

test('llamar al siguiente cierra la atencion anterior del mismo consultorio', async () => {
  const primera = await citaLibre('pro-perez')
  await repo.registrarLlegada(primera.id)

  const uno = await repo.llamarSiguiente({
    profesionalId: 'pro-perez',
    moduloId: 'mod-consultorio-1',
    funcionarioId: 'usuario-prueba',
  })

  const dos = await repo.llamarSiguiente({
    profesionalId: 'pro-perez',
    moduloId: 'mod-consultorio-1',
    funcionarioId: 'usuario-prueba',
  })

  if (dos) {
    const [anterior] = await repo.historico({ codigo: uno.codigo })
    assert.equal(anterior.estado, 'ATENDIDO')
    assert.ok(anterior.horaAtencion)
  }
})

test('marcar atendido cierra la cita y libera el consultorio', async () => {
  const cita = await citaLibre('pro-gomez')
  await repo.registrarLlegada(cita.id)

  const llamado = await repo.llamarSiguiente({
    profesionalId: 'pro-gomez',
    moduloId: 'mod-consultorio-2',
    funcionarioId: 'usuario-prueba',
  })

  const eventos = []
  const desuscribir = realtimeHub.subscribe((evento) => eventos.push(evento))
  const atendido = await repo.marcarAtendido(llamado.id)
  desuscribir()

  assert.equal(atendido.estado, 'ATENDIDO')
  assert.ok(atendido.horaAtencion)
  assert.ok(eventos.some((e) => e.tipo === 'modulo.liberado' && e.moduloId === 'mod-consultorio-2'))

  const { casillas } = await repo.estadoPantalla()
  const casilla = casillas.find((c) => c.moduloId === 'mod-consultorio-2')
  assert.equal(casilla.codigo, null)
})

test('marcar ausente deja el turno en estado AUSENTE', async () => {
  const { servicio, modulo } = await ventanillaPropia()

  const turno = await repo.generarTurnoDeVentanilla(servicio.id)
  const llamado = await repo.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: 'usuario-prueba',
  })

  assert.equal(llamado.id, turno.id)
  const ausente = await repo.marcarAusente(llamado.id)
  assert.equal(ausente.estado, 'AUSENTE')
})

test('los turnos prioritarios se atienden primero (seccion 14)', async () => {
  const { servicio } = await ventanillaPropia()

  const normal = await repo.generarTurnoDeVentanilla(servicio.id)
  const prioritario = await repo.generarTurnoDeVentanilla(servicio.id)
  prioritario.prioridad = 'PRIORITARIO'

  const pendientes = await repo.listarPendientes({ servicioId: servicio.id })
  const posPrioritario = pendientes.findIndex((t) => t.id === prioritario.id)
  const posNormal = pendientes.findIndex((t) => t.id === normal.id)

  assert.ok(posPrioritario < posNormal)
})

test('llamar sin pacientes en espera devuelve null', async () => {
  // Un doctor recien creado: su fila esta vacia con seguridad, sin depender de
  // lo que hayan dejado las pruebas anteriores.
  const modulo = await repo.crearModulo({
    nombre: 'Consultorio sin fila',
    servicioId: 'srv-consulta-externa',
    activo: true,
  })
  const doctor = await repo.crearProfesional({
    nombre: 'Dra. Sin Pacientes',
    servicioId: 'srv-consulta-externa',
    jornada: 'COMPLETA',
    moduloId: modulo.id,
  })

  const resultado = await repo.llamarSiguiente({
    profesionalId: doctor.id,
    moduloId: modulo.id,
    funcionarioId: 'usuario-prueba',
  })
  assert.equal(resultado, null)
})

test('un profesional que no existe no puede llamar', async () => {
  await assert.rejects(
    () =>
      repo.llamarSiguiente({
        profesionalId: 'pro-inexistente',
        moduloId: 'mod-consultorio-1',
        funcionarioId: 'usuario-prueba',
      }),
    /profesional indicado no existe/i,
  )
})

// El televisor muestra los consultorios QUE TRABAJAN HOY, no el catalogo.
//
// Esta prueba decia antes "una casilla por cada modulo activo", y eso dejo de
// ser cierto: el catalogo lo va llenando la carga diaria del reporte y de ahi
// nada se apaga, asi que a las pocas semanas el paciente tenia que buscar su
// consultorio entre quince casillas vacias. Lo que se fija ahora es el criterio
// nuevo, y esta en `lib/turnos/casillas.ts`.
test('el televisor no pinta consultorios que hoy no trabajan', async () => {
  const dormido = await repo.crearModulo({
    nombre: 'Consultorio que hoy no abre',
    servicioId: 'srv-consulta-externa',
    activo: true,
  })

  const { casillas } = await repo.estadoPantalla()

  assert.equal(
    casillas.find((c) => c.moduloId === dormido.id),
    undefined,
    'un consultorio sin doctor, sin citas y sin turnos no ocupa sitio en la pantalla',
  )
  assert.ok(casillas.length > 0, 'los que si trabajan siguen ahi')
  assert.ok(casillas.every((c) => typeof c.moduloNombre === 'string'))
})

test('las ventanillas de orden de llegada se ven siempre, tengan o no pacientes', async () => {
  // No tienen agenda que mirar, y esconderlas hasta el primer paciente dejaria
  // el televisor en blanco a la hora de abrir.
  const servicio = await repo.crearServicio({
    nombre: 'Facturacion de prueba',
    prefijo: 'F',
    modoFila: 'COMPARTIDA',
    activo: true,
  })
  const ventanilla = await repo.crearModulo({
    nombre: 'Ventanilla de prueba 1',
    servicioId: servicio.id,
    activo: true,
  })

  const { casillas } = await repo.estadoPantalla()

  assert.ok(
    casillas.find((c) => c.moduloId === ventanilla.id),
    'la ventanilla se ve desde que se abre el hospital',
  )
})

test('la agenda del profesional muestra PROGRAMADA antes de la llegada (trazabilidad)', async () => {
  const cita = await citaLibre('pro-salas')

  const agenda = await repo.agendaProfesional('pro-salas', cita.fecha)
  const item = agenda.find((i) => i.citaId === cita.id)

  assert.ok(item, 'la cita debe aparecer en la agenda aunque no haya llegado el paciente')
  assert.equal(item.estado, 'PROGRAMADA')
  assert.equal(item.turnoId, null)
  assert.equal(item.codigo, null)
  assert.equal(item.nombrePaciente, cita.nombrePaciente)
})

test('la agenda sigue al turno de punta a punta: PROGRAMADA -> EN_ESPERA -> LLAMADO -> ATENDIDA', async () => {
  const cita = await citaLibre('pro-rios')
  const fecha = cita.fecha

  const antes = await repo.agendaProfesional('pro-rios', fecha)
  assert.equal(antes.find((i) => i.citaId === cita.id).estado, 'PROGRAMADA')

  await repo.registrarLlegada(cita.id)
  const enEspera = await repo.agendaProfesional('pro-rios', fecha)
  assert.equal(enEspera.find((i) => i.citaId === cita.id).estado, 'EN_ESPERA')

  const llamado = await repo.llamarSiguiente({
    profesionalId: 'pro-rios',
    moduloId: 'mod-consultorio-3',
    funcionarioId: 'usuario-prueba',
  })
  const llamadaAgenda = await repo.agendaProfesional('pro-rios', fecha)
  assert.equal(llamadaAgenda.find((i) => i.citaId === cita.id).estado, 'LLAMADO')

  await repo.marcarAtendido(llamado.id)
  const final = await repo.agendaProfesional('pro-rios', fecha)
  assert.equal(final.find((i) => i.citaId === cita.id).estado, 'ATENDIDA')
})

test('un profesional inexistente en la agenda produce error', async () => {
  await assert.rejects(() => repo.agendaProfesional('pro-no-existe', '2026-01-01'), /profesional/i)
})

test('el servicio o el modulo inexistente producen error', async () => {
  await assert.rejects(() => repo.generarTurnoDeVentanilla('srv-no-existe'), /servicio/i)
  await assert.rejects(
    () =>
      repo.llamarSiguiente({
        servicioId: 'srv-consulta-externa',
        moduloId: 'mod-no-existe',
        funcionarioId: 'usuario-prueba',
      }),
    /modulo/i,
  )
})

// ---------------------------------------------------------------------------
// LA MAQUINA DE ESTADOS DEL TURNO
//
// Un turno solo se cierra si esta siendo atendido. Sin estas reglas se podia
// dar por atendido a alguien que seguia en la fila (desaparecia sin que nadie
// se enterara) o volver a cerrar un turno ya cerrado, reescribiendole la hora
// de atencion y ensuciando los tiempos del informe.
// ---------------------------------------------------------------------------

test('no se puede dar por atendido un turno que nunca fue llamado', async () => {
  const { servicio } = await ventanillaPropia()
  const turno = await repo.generarTurnoDeVentanilla(servicio.id)

  await assert.rejects(() => repo.marcarAtendido(turno.id), /todavia no ha sido llamado/i)
  await assert.rejects(() => repo.marcarAusente(turno.id), /todavia no ha sido llamado/i)

  // Sigue en la fila, que es donde debe estar.
  const pendientes = await repo.listarPendientes({ servicioId: servicio.id })
  assert.ok(pendientes.some((t) => t.id === turno.id))
})

test('un turno cerrado no se vuelve a cerrar ni le cambian la hora de atencion', async () => {
  const { servicio, modulo } = await ventanillaPropia()
  await repo.generarTurnoDeVentanilla(servicio.id)

  const llamado = await repo.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: 'usuario-prueba',
  })
  const atendido = await repo.marcarAtendido(llamado.id)
  const horaOriginal = atendido.horaAtencion

  await assert.rejects(() => repo.marcarAtendido(llamado.id), /ya esta cerrado/i)
  await assert.rejects(() => repo.marcarAusente(llamado.id), /ya esta cerrado/i)

  const [enHistorico] = await repo.historico({ codigo: llamado.codigo })
  assert.equal(enHistorico.horaAtencion, horaOriginal, 'la hora de atencion no se puede reescribir')
})

test('un turno ya cerrado no se puede volver a llamar a la pantalla', async () => {
  const { servicio, modulo } = await ventanillaPropia()
  await repo.generarTurnoDeVentanilla(servicio.id)

  const llamado = await repo.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: 'usuario-prueba',
  })
  await repo.marcarAtendido(llamado.id)

  // Repetirlo publicaria en la pantalla a un paciente que ya se fue, tapando
  // al que de verdad este dentro de ese consultorio.
  await assert.rejects(() => repo.repetirLlamado(llamado.id), /ya se cerro/i)
})

test('dos consultorios que llaman a la vez no se llevan al mismo paciente', async () => {
  const { servicio, modulo } = await ventanillaPropia()
  const otroModulo = await repo.crearModulo({
    nombre: 'Ventanilla paralela',
    servicioId: servicio.id,
    activo: true,
  })

  await repo.generarTurnoDeVentanilla(servicio.id)
  await repo.generarTurnoDeVentanilla(servicio.id)

  // Las dos peticiones salen sin esperar una a la otra, que es lo que pasa
  // cuando dos funcionarios pulsan "siguiente" en el mismo instante.
  const [uno, dos] = await Promise.all([
    repo.llamarSiguiente({ servicioId: servicio.id, moduloId: modulo.id, funcionarioId: 'f-1' }),
    repo.llamarSiguiente({ servicioId: servicio.id, moduloId: otroModulo.id, funcionarioId: 'f-2' }),
  ])

  assert.ok(uno && dos, 'los dos deberian recibir un paciente: habia dos en la fila')
  assert.notEqual(uno.id, dos.id, 'no pueden llamar al mismo paciente a dos consultorios')
})

test('el codigo del turno arranca en 001 para cada servicio y cada dia', async () => {
  const { servicio } = await ventanillaPropia()

  const primero = await repo.generarTurnoDeVentanilla(servicio.id)
  const segundo = await repo.generarTurnoDeVentanilla(servicio.id)

  // El contador va por dia y por prefijo (ver `siguienteCodigo`): un servicio
  // nuevo empieza en 001 aunque el sistema lleve meses operando.
  assert.equal(primero.codigo, `${servicio.prefijo}-001`)
  assert.equal(segundo.codigo, `${servicio.prefijo}-002`)
})

test('la pantalla no arrastra turnos de dias anteriores', async () => {
  const { servicio, modulo } = await ventanillaPropia()
  await repo.generarTurnoDeVentanilla(servicio.id)

  const llamado = await repo.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: 'usuario-prueba',
  })

  // Aparece ahora, recien llamado.
  const enPantalla = async () => {
    const { casillas } = await repo.estadoPantalla()
    return casillas.find((c) => c.moduloId === modulo.id)
  }
  assert.equal((await enPantalla()).codigo, llamado.codigo)

  // Se simula la jornada de ayer: el doctor termino y se fue sin cerrarlo, que
  // es lo que pasa todos los dias con el ultimo paciente.
  llamado.horaLlamado = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()

  assert.equal(
    (await enPantalla()).codigo,
    null,
    'el televisor no puede amanecer mostrando el turno de ayer',
  )
})

test('la fila de espera no arrastra pacientes de dias anteriores', async () => {
  const { servicio, modulo } = await ventanillaPropia()

  // El paciente de ayer que se quedo en la fila sin que nadie lo llamara: el
  // doctor termino la jornada y se fue. Su turno sigue EN_ESPERA para siempre.
  const deAyer = await repo.generarTurnoDeVentanilla(servicio.id)
  deAyer.fechaGeneracion = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()

  const deHoy = await repo.generarTurnoDeVentanilla(servicio.id)

  const pendientes = await repo.listarPendientes({ servicioId: servicio.id })
  assert.deepEqual(
    pendientes.map((t) => t.codigo),
    [deHoy.codigo],
    'el de ayer no puede seguir en la fila de hoy',
  )

  // Y sobre todo: "siguiente" no puede llamar al de ayer. La cola se ordena por
  // hora de generacion, asi que sin el filtro el mas viejo salia DE PRIMERO y
  // el televisor amanecia anunciando un codigo de ayer a una sala donde ese
  // paciente ya no esta.
  const llamado = await repo.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: 'usuario-prueba',
  })
  assert.equal(llamado.codigo, deHoy.codigo)

  // El de ayer no se borra: sigue en el historico con su estado real, que es lo
  // que hay que poder revisar despues.
  const historico = await repo.historico({ servicioId: servicio.id })
  const rastro = historico.find((t) => t.id === deAyer.id)
  assert.ok(rastro, 'el turno de ayer sigue registrado')
  assert.equal(rastro.estado, 'EN_ESPERA')
})

// La lectura del reporte de citas del hospital.
//
// Es la pieza que decide si un paciente aparece o no en la agenda del dia, y
// falla siempre por lo mismo: un formato de fecha distinto, un nombre con
// espacios de sobra, una fila vacia al final del informe. Todo eso se prueba
// aqui, contra el modulo puro, sin base de datos.
import assert from 'node:assert/strict'
import test from 'node:test'

const {
  claveDe,
  interpretarFila,
  leerReporteEnFilas,
  leerReporteXml,
  normalizarFecha,
  normalizarHora,
  servicioDeLaCita,
} = await import('@/lib/citas/reporte-hospital')

const { bloqueDeCita, jornadaDeHora, jornadaSegunHoras } = await import('@/lib/turnos/tiempo')

/** El horario del hospital por defecto: mañana hasta las 12, tarde desde la 1. */
const horario = { jornadaMananaFin: '12:00', jornadaTardeInicio: '13:00' }

const filaCompleta = {
  fecha: '14/09/2026',
  hora: '07:09',
  tipoDocumento: 'CC',
  documento: '1066183351',
  nombrePaciente: 'NANCY CATALINA ALVAREZ MADERA',
  cups: '890301',
  procedimiento: 'CONSULTA DE CONTROL O DE SEGUIMIENTO POR MEDICINA GENERAL',
  consultorio: 'CONS 01- CONSULTA EXTERNA',
  profesional: 'YENNY  CORTES ',
}

test('la fecha del reporte viene en formato colombiano DD/MM/AAAA', () => {
  assert.equal(normalizarFecha('14/09/2026'), '2026-09-14')
  assert.equal(normalizarFecha('4/9/2026'), '2026-09-04')
  // Si algun dia el informe cambiara a ISO, tambien entra.
  assert.equal(normalizarFecha('2026-09-14'), '2026-09-14')
  assert.equal(normalizarFecha('no es una fecha'), null)
  assert.equal(normalizarFecha(''), null)
})

test('una celda de fecha de Excel se toma tal cual, sin correrla de dia', () => {
  // Excel entrega la fecha como medianoche UTC del dia que muestra la celda.
  // Convertirla a hora de Colombia la correria al dia anterior, y toda la
  // agenda entraria con un dia de desfase.
  assert.equal(normalizarFecha(new Date('2026-09-14T00:00:00Z')), '2026-09-14')
})

test('la hora acepta las formas en que sale del informe', () => {
  assert.equal(normalizarHora('07:00'), '07:00')
  assert.equal(normalizarHora('7:09'), '07:09')
  assert.equal(normalizarHora('07:09:00'), '07:09')
  assert.equal(normalizarHora('25:00'), null)
  assert.equal(normalizarHora('mediodia'), null)
})

test('la cita se guarda en hora de Colombia, no en la del servidor', () => {
  const cita = interpretarFila(1, filaCompleta)
  // 07:09 en Colombia (UTC-5) son las 12:09 UTC.
  assert.equal(cita.horaCita, '2026-09-14T12:09:00.000Z')
  assert.equal(cita.fecha, '2026-09-14')
})

test('odontologia va aparte; todo lo demas cuelga de consulta externa', () => {
  assert.equal(servicioDeLaCita('CONSULTA DE PRIMERA VEZ POR ODONTOLOGÍA GENERAL', '').nombre, 'Odontologia')
  assert.equal(servicioDeLaCita('CONSULTA DE PRIMERA VEZ POR MEDICINA GENERAL', '').nombre, 'Consulta externa')
  assert.equal(servicioDeLaCita('CONSULTA DE PRIMERA VEZ POR PSICOLOGÍA', '').nombre, 'Consulta externa')
  // Sin procedimiento, manda el nombre del consultorio.
  assert.equal(servicioDeLaCita('', 'CONS 02 - ODONTOLOGIA PYM').nombre, 'Odontologia')
})

test('el mismo doctor escrito con espacios de sobra es UN solo doctor', () => {
  // En el reporte real viene 'YENNY  CORTES ' con dos espacios y uno al final.
  // Sin normalizar, cada variante crearia un doctor distinto en el catalogo,
  // cada uno con su fila de pacientes que nadie llamaria.
  assert.equal(claveDe('YENNY  CORTES '), claveDe('Yenny Cortes'))
  assert.equal(claveDe('JOSÉ ORDOSGOITIA'), claveDe('JOSE ORDOSGOITIA'))

  const cita = interpretarFila(1, filaCompleta)
  assert.equal(cita.profesional.nombre, 'YENNY CORTES')
})

test('el documento entra solo con digitos, como lo escribe admisiones', () => {
  // El reporte a veces trae puntos o espacios. Si no coincide caracter a
  // caracter con lo que teclea admisiones, el paciente esta en el sistema y
  // aun asi "no aparece".
  const cita = interpretarFila(1, { ...filaCompleta, documento: '1.066.183.351' })
  assert.equal(cita.documentoPaciente, '1066183351')
})

test('una fila incompleta se rechaza con el motivo, sin tumbar la carga', () => {
  const sinDocumento = interpretarFila(7, { ...filaCompleta, documento: '  ' })
  assert.equal(sinDocumento.fila, 7)
  assert.match(sinDocumento.motivo, /documento/i)

  const sinDoctor = interpretarFila(9, { ...filaCompleta, profesional: '' })
  assert.match(sinDoctor.motivo, /profesional/i)

  const horaMala = interpretarFila(3, { ...filaCompleta, hora: 'a las siete' })
  assert.match(horaMala.motivo, /Hora/i)
})

test('no se guarda del paciente nada que no haga falta para el turno', () => {
  // Requerimiento seccion 17. El reporte trae edad, sexo, telefono, EPS y
  // contrato; ninguno de esos campos puede acabar en la cita.
  const cita = interpretarFila(1, filaCompleta)
  const campos = Object.keys(cita)
  for (const prohibido of ['edad', 'sexo', 'telefono', 'entidad', 'contrato']) {
    assert.ok(
      !campos.some((campo) => campo.toLowerCase().includes(prohibido)),
      `la cita no deberia llevar "${prohibido}"`,
    )
  }
})

// --- Formato XML (el del servidor de informes del hospital) -----------------

const XML_DE_EJEMPLO = `<?xml version="1.0" encoding="utf-8"?>
<Report Name="ReporteCitasAsignadas"><Tablix1><Detalles_Collection>
<Detalles fecha_inicio="14/09/2026" hora_inicio="07:00" tipo_documento="CC" numero_documento1="1066183351" nombre_paciente="NANCY CATALINA ALVAREZ MADERA" Edad="32 años" Sexo="FEMENINO" telefono_paciente="3205240881" cusp="890301" NombreProcedimiento="CONSULTA DE CONTROL O DE SEGUIMIENTO POR MEDICINA GENERAL" descripcion_consultorio="CONS 01- CONSULTA EXTERNA" nombre_profesional="YENNY  CORTES " nombre_entidad="PROTEGER EPS" contrato_entidad="11772" />
<Detalles fecha_inicio="14/09/2026" hora_inicio="07:13" tipo_documento="CC" numero_documento1="6615526" nombre_paciente="ISMAEL  ZABALA MONTES" Edad="81 años" Sexo="MASCULINO" telefono_paciente="3167960991" cusp="890303" NombreProcedimiento="CONSULTA DE CONTROL O DE SEGUIMIENTO POR ODONTOLOGÍA GENERAL" descripcion_consultorio="CONS 01- ODONTOLOGIA" nombre_profesional="OSCAR  HERAZO PACHECO" nombre_entidad="MUTUAL SER" contrato_entidad="22315" />
<Detalles fecha_inicio="" hora_inicio="07:20" tipo_documento="CC" numero_documento1="123" nombre_paciente="SIN FECHA" cusp="890301" NombreProcedimiento="X" descripcion_consultorio="CONS 01- CONSULTA EXTERNA" nombre_profesional="YENNY CORTES" />
</Detalles_Collection></Tablix1></Report>`

test('el XML del hospital se lee entero, y la fila mala sale aparte', () => {
  const { filas, errores, fechas } = leerReporteXml(XML_DE_EJEMPLO)

  assert.equal(filas.length, 2)
  assert.equal(errores.length, 1)
  assert.equal(errores[0].fila, 3)
  assert.deepEqual(fechas, ['2026-09-14'])

  assert.equal(filas[0].nombrePaciente, 'NANCY CATALINA ALVAREZ MADERA')
  assert.equal(filas[0].servicio.nombre, 'Consulta externa')
  assert.equal(filas[1].servicio.nombre, 'Odontologia')
  assert.equal(filas[1].consultorio.nombre, 'CONS 01- ODONTOLOGIA')
})

test('un archivo que no es el reporte de citas lo dice, en vez de cargar cero', () => {
  const { filas, errores } = leerReporteXml('<Report><Otra/></Report>')
  assert.equal(filas.length, 0)
  assert.equal(errores.length, 1)
  assert.match(errores[0].motivo, /no contiene citas/i)
})

// --- Formato Excel ----------------------------------------------------------

const HOJA = [
  ['Citas  citas asignadas'],
  ['fecha inicial: 13/09/2026  FechaFinal:  14/09/2026'],
  [],
  [
    'Fecha',
    'Hora',
    'Tipo',
    'Documento',
    'Nombre Paciente',
    'Edad',
    'Sexo',
    'Teléfono',
    'CUPS',
    'Nombre proc.',
    'Consultorio',
    'Nombre prof.',
    'Entidad',
    'Usuario creación',
    'Fecha creación',
  ],
  [
    '14/09/2026',
    '07:00',
    'CC',
    '1066183351',
    'NANCY CATALINA ALVAREZ MADERA',
    '32 años',
    'FEMENINO',
    '3205240881',
    '890301',
    'CONSULTA DE CONTROL O DE SEGUIMIENTO POR MEDICINA GENERAL',
    'CONS 01- CONSULTA EXTERNA',
    'YENNY  CORTES ',
    'PROTEGER EPS',
    'YINAOLIVEROS',
    '04/09/2026 10:09',
  ],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
]

test('el encabezado del Excel se busca: no esta en la primera fila', () => {
  const { filas, errores } = leerReporteEnFilas(HOJA)

  assert.equal(errores.length, 0)
  assert.equal(filas.length, 1)
  assert.equal(filas[0].documentoPaciente, '1066183351')
  assert.equal(filas[0].fecha, '2026-09-14')
  // La fila en blanco del final no es un rechazo: se salta en silencio, para
  // que el informe de carga solo liste lo que de verdad hay que mirar.
})

test('las columnas se resuelven por nombre, y "Fecha creación" no gana a "Fecha"', () => {
  // Si ganara la de creacion, la agenda entraria con la fecha en que el
  // funcionario agendo, no con la del dia de la cita.
  const { filas } = leerReporteEnFilas(HOJA)
  assert.equal(filas[0].fecha, '2026-09-14')
})

test('si al reporte le faltan columnas, se dice cuales', () => {
  const sinProfesional = HOJA.map((fila, i) =>
    i >= 3 ? fila.filter((_, columna) => columna !== 11) : fila,
  )
  const { filas, errores } = leerReporteEnFilas(sinProfesional)

  assert.equal(filas.length, 0)
  assert.equal(errores.length, 1)
  assert.match(errores[0].motivo, /Nombre prof/i)
})

test('un archivo sin encabezado reconocible no se carga a medias', () => {
  const { filas, errores } = leerReporteEnFilas([['hola'], ['mundo']])
  assert.equal(filas.length, 0)
  assert.match(errores[0].motivo, /encabezado/i)
})

// --- La jornada de cada doctor ---
//
// El reporte no trae ninguna columna que diga en que jornada trabaja el doctor,
// asi que todos entraban de dia completo. En la parrilla eso significaba que el
// medico que atiende hasta las once aparecia tambien en la tarde y que se le
// podia citar un paciente a las tres. Sus horas si lo dicen.

test('la hora de la cita dice a que jornada pertenece, y el almuerzo no es de nadie', () => {
  assert.equal(jornadaDeHora('07:09', horario), 'MANANA')
  assert.equal(jornadaDeHora('11:20', horario), 'MANANA')
  assert.equal(jornadaDeHora('13:00', horario), 'TARDE')
  assert.equal(jornadaDeHora('16:14', horario), 'TARDE')

  // Entre el cierre de la mañana y la apertura de la tarde esta el almuerzo. No
  // se reparte a ningun lado: quien decide de quien es esa hora es el doctor
  // que atiende en ella, no el reloj.
  assert.equal(jornadaDeHora('12:20', horario), null)
  assert.equal(jornadaDeHora('12:59', horario), null)
})

test('el doctor que solo atiende antes del mediodia es de la jornada de la mañana', () => {
  // Caso real: ERNESTO MILLAN, de 07:00 a 11:20.
  assert.equal(jornadaSegunHoras(['07:00', '09:15', '11:20'], horario), 'MANANA')
})

test('el que empieza a las 12:20 y termina a las 16:14 es de la TARDE, no de dia completo', () => {
  // ESTE ES EL CASO QUE HABIA QUE ARREGLAR. En el hospital hay cuatro doctores
  // con ese horario: es la jornada de la tarde entrando un poco antes del
  // almuerzo. Contando las 12:20 como mañana, los cuatro salian de "dia
  // completo" y aparecian en la parrilla de la mañana, donde no atienden.
  assert.equal(jornadaSegunHoras(['12:20', '14:00', '16:14'], horario), 'TARDE')
})

test('el que tiene pacientes a los dos lados del almuerzo hace el dia completo', () => {
  // Caso real: ALVARO JAVIER MACEA, de 07:00 a 16:14.
  assert.equal(jornadaSegunHoras(['07:00', '16:14'], horario), 'COMPLETA')
})

test('una sola cita basta para ubicar al doctor', () => {
  // El especialista que viene un rato: con una cita a las tres, su columna
  // tiene que salir en la tarde y no en la mañana.
  assert.equal(jornadaSegunHoras(['15:00'], horario), 'TARDE')
})

test('sin citas no se deduce nada: al doctor se le deja la jornada que tenga', () => {
  // Devolver COMPLETA aqui seria inventarle un horario a quien hoy no aparece
  // en el reporte, y de paso pisarle al administrador la jornada que puso a
  // mano en Profesionales.
  assert.equal(jornadaSegunHoras([], horario), null)
  // Lo mismo si todas sus citas cayeron dentro del almuerzo: no hay de donde.
  assert.equal(jornadaSegunHoras(['12:20', '12:40'], horario), null)
})

test('las jornadas se leen de la configuracion, no de unas horas fijas', () => {
  // Si el hospital mueve el almuerzo, el corte se mueve con el.
  const otro = { jornadaMananaFin: '13:00', jornadaTardeInicio: '14:00' }
  assert.equal(jornadaSegunHoras(['12:20', '16:14'], otro), 'COMPLETA')
  assert.equal(jornadaDeHora('13:30', otro), null)
})

// --- Donde se pinta cada cita ---
//
// Ubicar la hora puede dar "en ninguna" (el almuerzo), pero pintarla no: la
// cita tiene que verse en algun bloque o el paciente desaparece de la agenda.

test('la cita del almuerzo se pinta en el bloque del doctor que la atiende', () => {
  // Las 12:20 del que atiende de 12:20 a 16:14 son su tarde...
  assert.equal(bloqueDeCita('12:20', horario, 'TARDE'), 'TARDE')
  // ...y las del que hace mañana, su mañana alargada.
  assert.equal(bloqueDeCita('12:20', horario, 'MANANA'), 'MANANA')
  // Del que hace el dia completo, o del que no se sabe, se toma como mañana.
  assert.equal(bloqueDeCita('12:20', horario, 'COMPLETA'), 'MANANA')
  assert.equal(bloqueDeCita('12:20', horario, null), 'MANANA')
})

test('fuera del almuerzo manda la hora, no la jornada del doctor', () => {
  // Un doctor marcado de tarde con una cita a las 8 no la esconde en la tarde:
  // se pinta donde esta, que es como se ve que algo no cuadra.
  assert.equal(bloqueDeCita('08:00', horario, 'TARDE'), 'MANANA')
  assert.equal(bloqueDeCita('15:00', horario, 'MANANA'), 'TARDE')
})

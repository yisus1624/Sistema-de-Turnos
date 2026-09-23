// Integracion contra PostgreSQL DE VERDAD para el repositorio de Prisma.
//
// Las demas pruebas usan el repositorio en memoria, donde no hay concurrencia
// real. Las carreras que importan (dos equipos del mismo doctor, "Ausente"
// contra "Siguiente", dos llegadas con el mismo prefijo) solo existen en
// PostgreSQL, y aqui se provocan de forma DETERMINISTA: una transaccion retiene
// un candado, se espera a que la otra quede bloqueada en pg_stat_activity, y
// solo entonces se suelta.
//
// COMO CORRERLA (base desechable, lo recomendado):
//
//   docker run --rm -d --name turnos-pruebas -e POSTGRES_PASSWORD=pruebas -p 55432:5432 postgres:16
//   # Las DOS variables con la MISMA URL de pruebas, solo para este comando:
//   # `prisma migrate deploy` usa DIRECT_URL, y si no se fija la lee del .env,
//   # que apunta a la base del hospital.
//   DATABASE_URL=postgresql://postgres:pruebas@localhost:55432/postgres \
//   DIRECT_URL=postgresql://postgres:pruebas@localhost:55432/postgres npx prisma migrate deploy
//   TEST_DATABASE_URL=postgresql://postgres:pruebas@localhost:55432/postgres npm test -- tests/integracion-postgres.test.mjs
//   docker stop turnos-pruebas
//
// GUARDAS. Sin `TEST_DATABASE_URL` se salta. Se niega a correr si la base no es
// local, o si `TEST_DATABASE_URL` apunta a la misma base que DATABASE_URL o
// DIRECT_URL (del entorno o del .env): esa puede ser la base del hospital. Solo
// con `TURNOS_INTEGRACION_PERMITIR_BASE_REMOTA=1`, puesto a mano, corre contra
// una base remota.
//
// QUE ESCRIBE Y QUE BORRA. Solo crea filas propias, todas colgadas de servicios
// cuyo nombre empieza por `ZZ-INTEG ` y con prefijo de turno propio (`ZZT...`),
// que no chocan con los reales. Al empezar borra lo que haya dejado una corrida
// anterior con ese prefijo, y al terminar (tambien si una prueba falla) borra
// todo lo que creo, en orden de claves foraneas. No toca turnos, citas ni
// catalogos que no haya creado: el candado de codigos es por prefijo y el
// cierre automatico solo alcanza a los turnos de sus propios doctores.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { after, before } from 'node:test'

const PREFIJO_DE_NOMBRES = 'ZZ-INTEG '
const URL_DE_PRUEBAS = process.env.TEST_DATABASE_URL
const motivoParaNoCorrer = URL_DE_PRUEBAS ? motivoDeRechazo(URL_DE_PRUEBAS) : null

if (!URL_DE_PRUEBAS) {
  test('integracion con PostgreSQL', { skip: 'Sin TEST_DATABASE_URL: se salta. Ver la cabecera de este archivo.' }, () => {})
} else if (motivoParaNoCorrer) {
  test('integracion con PostgreSQL', () => assert.fail(`No se corre: ${motivoParaNoCorrer}`))
} else {
  await correrSuite(URL_DE_PRUEBAS)
}

/** La base de una URL (usuario, host, puerto y nombre), sin la contraseña. */
function baseDe(url) {
  try {
    const u = new URL(url)
    return `${u.username}@${u.hostname}:${u.port || '5432'}${u.pathname}`
  } catch {
    return null
  }
}

/** DATABASE_URL y DIRECT_URL del entorno y de los archivos .env del proyecto. */
function basesConocidas() {
  const valores = [process.env.DATABASE_URL, process.env.DIRECT_URL]
  for (const archivo of ['.env', '.env.local']) {
    let texto = ''
    try {
      texto = readFileSync(archivo, 'utf8')
    } catch {
      continue
    }
    for (const clave of ['DATABASE_URL', 'DIRECT_URL']) {
      const encontrado = texto.match(new RegExp(`^${clave}="?([^"\\n]+)`, 'm'))
      if (encontrado) valores.push(encontrado[1])
    }
  }
  return valores.filter(Boolean).map(baseDe)
}

function motivoDeRechazo(url) {
  if (process.env.TURNOS_INTEGRACION_PERMITIR_BASE_REMOTA === '1') return null
  const base = baseDe(url)
  if (!base) return 'TEST_DATABASE_URL no es una URL valida.'
  const host = new URL(url).hostname
  if (!['localhost', '127.0.0.1'].includes(host)) return 'la base de pruebas no es local (localhost/127.0.0.1).'
  if (basesConocidas().includes(base)) return 'TEST_DATABASE_URL apunta a la misma base que DATABASE_URL o DIRECT_URL.'
  return null
}

async function correrSuite(url) {
  // `lib/prisma.ts` lee DATABASE_URL al crear el cliente: se apunta a la base
  // de pruebas ANTES de importarlo, y solo dentro de este proceso de prueba.
  process.env.DATABASE_URL = url
  process.env.DIRECT_URL = url

  const { prisma } = await import('@/lib/prisma')
  const { PrismaTurnoRepository } = await import('@/lib/turnos/prisma-repository')
  const repo = new PrismaTurnoRepository()

  const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
  const marca = Date.now().toString(36).slice(-4).toUpperCase()
  let secuencia = 0
  const unico = (texto) => `${PREFIJO_DE_NOMBRES}${texto} ${marca}-${++secuencia}`

  /** Borra, en orden de claves foraneas, todo lo que cuelga de servicios de la suite. */
  async function limpiar() {
    const servicios = await prisma.servicio.findMany({
      where: { nombre: { startsWith: PREFIJO_DE_NOMBRES } },
      select: { id: true },
    })
    const ids = servicios.map((s) => s.id)
    if (ids.length === 0) return
    await prisma.turno.deleteMany({ where: { servicioId: { in: ids } } })
    await prisma.cita.deleteMany({ where: { servicioId: { in: ids } } })
    await prisma.accesoProfesional.deleteMany({ where: { profesional: { servicioId: { in: ids } } } })
    await prisma.profesional.deleteMany({ where: { servicioId: { in: ids } } })
    await prisma.modulo.deleteMany({ where: { servicioId: { in: ids } } })
    await prisma.servicio.deleteMany({ where: { id: { in: ids } } })
  }

  before(limpiar)
  after(async () => {
    try {
      await limpiar()
    } finally {
      await prisma.$disconnect()
    }
  })

  async function consultorioConDoctor() {
    const servicio = await repo.crearServicio({
      nombre: unico('Servicio'),
      prefijo: `ZZT${marca}${secuencia}`,
      modoFila: 'POR_PROFESIONAL',
      activo: true,
    })
    const modulo = await repo.crearModulo({ nombre: unico('Consultorio'), servicioId: servicio.id, activo: true })
    const otroModulo = await repo.crearModulo({ nombre: unico('Consultorio'), servicioId: servicio.id, activo: true })
    const doctor = await repo.crearProfesional({
      nombre: unico('Dr.'),
      servicioId: servicio.id,
      jornada: 'COMPLETA',
      moduloId: modulo.id,
    })
    return { servicio, modulo, otroModulo, doctor }
  }

  // Las citas se siembran directo: aqui se prueba la concurrencia del turno,
  // no las reglas de la parrilla (esas ya las cubren las pruebas en memoria).
  async function citaDeHoy({ servicio, doctor }) {
    return prisma.cita.create({
      data: {
        documentoPaciente: `ZZ${marca}${++secuencia}`,
        nombrePaciente: unico('Paciente'),
        profesionalId: doctor.id,
        servicioId: servicio.id,
        // Una hora distinta por cita: la base no admite dos citas del mismo
        // doctor a la misma hora (indice unico).
        horaCita: new Date(Date.now() + ++secuencia * 60_000),
        fecha: HOY,
      },
    })
  }

  async function enEspera(consultorio) {
    return (await repo.registrarLlegada((await citaDeHoy(consultorio)).id)).turno
  }

  const llamar = ({ doctor }, modulo, esperado) =>
    repo.llamarSiguiente({ profesionalId: doctor.id, moduloId: modulo.id, funcionarioId: doctor.id, turnoAbiertoEsperado: esperado })

  /**
   * Retiene candados dentro de una transaccion hasta que se la suelte. Devuelve
   * `soltar()` y la promesa de la transaccion.
   */
  function retener(trabajo) {
    let soltar
    const puerta = new Promise((resolver) => {
      soltar = resolver
    })
    const transaccion = prisma.$transaction(
      async (tx) => {
        await trabajo(tx)
        await puerta
      },
      { maxWait: 10_000, timeout: 30_000 },
    )
    return { soltar, transaccion }
  }

  /** Espera a que `cuantas` sesiones esten bloqueadas en una consulta que contiene `texto`. */
  async function esperarBloqueadas(texto, cuantas) {
    for (let intento = 0; intento < 200; intento += 1) {
      const [{ n }] = await prisma.$queryRaw`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND usename = current_user
          AND wait_event_type = 'Lock' AND query LIKE ${`%${texto}%`}`
      if (n >= cuantas) return
      await new Promise((resolver) => setTimeout(resolver, 50))
    }
    assert.fail(`nunca quedaron ${cuantas} sesiones bloqueadas en "${texto}"`)
  }

  test('dos llegadas simultaneas con el mismo prefijo reciben codigos distintos', async () => {
    const consultorio = await consultorioConDoctor()
    const citas = await Promise.all([citaDeHoy(consultorio), citaDeHoy(consultorio), citaDeHoy(consultorio)])

    const llegadas = await Promise.all(citas.map((cita) => repo.registrarLlegada(cita.id)))

    assert.equal(new Set(llegadas.map((l) => l.turno.codigo)).size, 3)
  })

  test('la misma cita registrada dos veces a la vez genera un solo turno', async () => {
    const consultorio = await consultorioConDoctor()
    const cita = await citaDeHoy(consultorio)

    const [a, b] = await Promise.all([repo.registrarLlegada(cita.id), repo.registrarLlegada(cita.id)])

    assert.equal(a.turno.id, b.turno.id)
    assert.equal(await prisma.turno.count({ where: { citaId: cita.id } }), 1)
  })

  test('"Ausente" confirma mientras "Siguiente" espera: la cita no queda ATENDIDA', async () => {
    const consultorio = await consultorioConDoctor()
    await enEspera(consultorio)
    await enEspera(consultorio)
    const a = await llamar(consultorio, consultorio.modulo, null)

    // Otro equipo marca a A como ausente y RETIENE su fila sin confirmar.
    const ausente = retener((tx) =>
      tx.turno.update({ where: { id: a.id }, data: { estado: 'AUSENTE', cerradoEn: new Date(), cierreAutomatico: false } }),
    )
    // "Siguiente" con esperado=A: valida A, reclama a B y se bloquea al ir a cerrar A.
    const siguiente = llamar(consultorio, consultorio.modulo, a.id)
    await esperarBloqueadas('FOR UPDATE', 1)
    ausente.soltar()
    await ausente.transaccion
    const b = await siguiente

    const turnoA = await prisma.turno.findUniqueOrThrow({ where: { id: a.id }, include: { cita: true } })
    assert.equal(turnoA.estado, 'AUSENTE')
    assert.notEqual(turnoA.cita?.estado, 'ATENDIDA', 'la cita del ausente no se marca atendida')
    assert.equal(turnoA.cierreAutomatico, false)
    assert.equal(b.estado, 'LLAMADO')
  })

  test('el mismo doctor en dos consultorios a la vez: uno llama, el otro recibe 409', async () => {
    const consultorio = await consultorioConDoctor()
    for (let i = 0; i < 3; i += 1) await enEspera(consultorio)
    const a = await llamar(consultorio, consultorio.modulo, null)

    // Se retiene el candado del doctor para que los dos llamados queden en fila.
    const clave = `llamar:profesional:${consultorio.doctor.id}`
    const candado = retener((tx) => tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${clave}))`)
    await new Promise((resolver) => setTimeout(resolver, 200))
    const llamados = [llamar(consultorio, consultorio.modulo, a.id), llamar(consultorio, consultorio.otroModulo, a.id)]
    await esperarBloqueadas('pg_advisory_xact_lock', 2)
    candado.soltar()
    await candado.transaccion
    const resultados = await Promise.allSettled(llamados)

    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(resultados.filter((r) => r.status === 'rejected' && r.reason.status === 409).length, 1)
    const turnos = await prisma.turno.findMany({ where: { profesionalId: consultorio.doctor.id } })
    assert.equal(turnos.filter((t) => t.cierreAutomatico).length, 1, 'solo se cerro A, el validado')
    assert.equal(turnos.filter((t) => t.estado === 'LLAMADO').length, 1)
  })

  test('"Atendido" repetido a la vez: una sola vez, sin rehacer la hora', async () => {
    const consultorio = await consultorioConDoctor()
    await enEspera(consultorio)
    const a = await llamar(consultorio, consultorio.modulo, null)

    const [r1, r2] = await Promise.all([repo.marcarAtendido(a.id, 'u1'), repo.marcarAtendido(a.id, 'u1')])

    assert.deepEqual([r1.yaAplicada, r2.yaAplicada].sort(), [false, true])
    assert.equal(r1.turno.horaAtencion, r2.turno.horaAtencion)
  })

  test('el cierre automatico no toca un turno abierto de un dia anterior', async () => {
    const consultorio = await consultorioConDoctor()
    await enEspera(consultorio)
    const deAyer = await llamar(consultorio, consultorio.modulo, null)
    // En PostgreSQL el dia vive en la columna `fecha`: se mueven las dos.
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await prisma.turno.update({
      where: { id: deAyer.id },
      data: { fecha: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ayer), fechaGeneracion: ayer },
    })

    await enEspera(consultorio)
    await llamar(consultorio, consultorio.modulo, null)

    assert.equal((await prisma.turno.findUniqueOrThrow({ where: { id: deAyer.id } })).estado, 'LLAMADO')
  })
}

// LA AUTORIZACION DE CADA ENDPOINT, COMPROBADA UNA POR UNA.
//
// Ocultar un boton en la pantalla no protege nada: quien conoce la URL llama a
// la API igual. Lo unico que protege los datos de los pacientes es que CADA
// route handler compruebe permisos en el servidor, y eso hasta ahora solo lo
// sostenia la revision a ojo: un `requireSeccion` olvidado en una ruta nueva no
// lo detectaba nadie.
//
// Estas pruebas RECORREN EL DISCO. No hay una lista de rutas que mantener: se
// descubre cada `app/api/**/route.ts` y se invoca cada metodo que exporta. Una
// ruta nueva sin proteccion hace fallar la prueba el dia que se escribe, sin
// que nadie tenga que acordarse de nada.
//
// Se comprueba el COMPORTAMIENTO visible: que responde el handler y que lleva
// el cuerpo. Como compruebe el permiso por dentro es asunto suyo.
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RAIZ = path.resolve(import.meta.dirname, '..')
const comoUrl = (relativa) => pathToFileURL(path.join(RAIZ, relativa)).href

/**
 * La sesion que ven los handlers en esta prueba.
 *
 * Es la ENTRADA del control de acceso, asi que se inyecta: cada prueba dice
 * quien esta llamando a la API. Todo lo demas (que secciones abre cada rol, que
 * responde cada handler) corre de verdad.
 */
let sesion = null

mock.module(comoUrl('lib/auth.ts'), {
  namedExports: {
    auth: async () => sesion,
    handlers: {},
    signIn: async () => {},
    signOut: async () => {},
  },
})

// Fuera de un servidor Next no hay ambito de peticion, y los handlers piden las
// cabeceras para anotar la IP en la auditoria. Se les da un ambito minimo.
mock.module(comoUrl('node_modules/next/headers.js'), {
  namedExports: {
    headers: async () => new Headers({ 'user-agent': 'prueba' }),
    cookies: async () => ({ get: () => undefined, getAll: () => [] }),
    draftMode: async () => ({ isEnabled: false }),
  },
})

// El registro de seguridad escribe en la base con Prisma, y los repositorios en
// memoria no lo cubren. Sin sustituirlo, cada rechazo del consultorio (sin
// cookie, token malformado) insertaba un evento en la base de DATABASE_URL:
// "accesos fallidos" de mentira en la bitacora de produccion, y minutos de
// espera por evento cuando no hay red. Lo demas (limitador, contexto de la
// peticion) sigue siendo el real; solo los eventos no salen del proceso.
const registroReal = await import(comoUrl('lib/seguridad/registro.ts'))
mock.module(comoUrl('lib/seguridad/registro.ts'), {
  namedExports: {
    ...registroReal,
    registrarEvento: async () => {},
    listarEventos: async () => [],
    tiposDeEvento: async () => [],
  },
})

// Las pruebas nunca tocan la base de datos real. Ver el modulo.
await import('./repositorios-en-memoria.mjs')

const { turnoRepository } = await import('@/lib/turnos/repositorio')

const METODOS_HTTP = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Las UNICAS rutas abiertas sin sesion, y por que.
 *
 * La pantalla de la sala de espera cuelga de un televisor que nadie va a
 * autenticar cada dia: por eso su estado y su canal de eventos son publicos, y
 * por eso ninguno de los dos lleva jamas datos del paciente (se comprueba al
 * final de este archivo). Cualquier otra ruta que empiece a responder sin
 * sesion rompe la prueba de mas abajo, que es justo lo que se busca.
 */
const RUTAS_PUBLICAS = new Set(['app/api/turnos/pantalla', 'app/api/turnos/stream'])

/**
 * El endpoint de NextAuth es el inicio de sesion en si mismo: tiene que ser
 * alcanzable sin sesion, y quien lo protege es NextAuth, no este proyecto.
 */
const RUTA_DE_LOGIN = 'app/api/auth/[...nextauth]'

/**
 * Rutas que basta con haber iniciado sesion para leer. DECISION CONSCIENTE, no
 * un descuido.
 *
 * Los nombres de servicios, consultorios y medicos los necesita cualquier
 * pantalla del sistema para escribir "Consulta externa" en vez de un
 * identificador, y no son datos de paciente. El historico esta aqui porque el
 * propio handler recorta lo que devuelve a los turnos del funcionario que
 * pregunta: eso se comprueba abajo, incluso intentando forzarlo por la query.
 *
 * Todo lo que NO este en esta lista tiene que rechazar a un usuario sin
 * secciones. Agregar algo aqui es una decision que queda escrita.
 */
const ABIERTAS_A_CUALQUIER_SESION = new Set([
  'app/api/turnos/servicios GET',
  'app/api/turnos/modulos GET',
  'app/api/turnos/profesionales GET',
  'app/api/turnos/historico GET',

  // CAMBIAR LA PROPIA CONTRASENA. Es la unica de la lista que escribe, y la
  // unica que no depende de ninguna seccion a proposito: cualquiera con cuenta
  // tiene que poder cambiar su clave, incluso un operador al que le retiraron
  // todo el menu. No toca la cuenta de nadie mas —el id sale de la sesion, no
  // del cuerpo— y exige la contrasena actual, con tope de intentos.
  'app/api/cuenta/contrasena POST',
])

/** Un funcionario con cuenta valida al que le retiraron todas las secciones. */
const OPERADOR_SIN_SECCIONES = {
  user: { id: 'usr-sin-secciones', rol: 'OPERADOR', secciones: [], nombre: 'Sin permisos' },
}

function rutasDeApi(directorio = 'app/api') {
  const entradas = readdirSync(path.join(RAIZ, directorio), { withFileTypes: true })
  const aqui = entradas.some((e) => e.isFile() && e.name === 'route.ts') ? [directorio] : []
  const dentro = entradas
    .filter((e) => e.isDirectory())
    .flatMap((e) => rutasDeApi(`${directorio}/${e.name}`))
  return [...aqui, ...dentro]
}

/** Los metodos HTTP que esa ruta atiende de verdad, con su handler. */
async function metodosDe(ruta) {
  const modulo = await import(`@/${ruta}/route`)
  return METODOS_HTTP.filter((metodo) => typeof modulo[metodo] === 'function').map((metodo) => ({
    ruta,
    metodo,
    ejecutar: modulo[metodo],
  }))
}

/** Invoca el handler como lo hace Next: una peticion y los parametros de la URL. */
async function invocar({ ruta, metodo, ejecutar }, cabecerasExtra = {}) {
  const url = `http://localhost/${ruta.slice('app/'.length)}`.replace(/\[[^\]]+\]/g, 'x')
  const peticion = new Request(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...cabecerasExtra },
    body: metodo === 'GET' ? undefined : '{}',
  })
  const parametros = { id: 'x', token: 'token-inventado', turnoId: 'x' }
  return ejecutar(peticion, { params: Promise.resolve(parametros) })
}

/** Un rechazo de verdad: el status correcto y ni un dato en el cuerpo. */
async function assertRechazo(respuesta, quien) {
  assert.ok(
    respuesta.status === 401 || respuesta.status === 403,
    `${quien} respondio ${respuesta.status}; se esperaba 401 o 403`,
  )
  const cuerpo = await respuesta.json()
  assert.deepEqual(
    Object.keys(cuerpo),
    ['error'],
    `${quien} devolvio algo mas que el mensaje de error: ${JSON.stringify(cuerpo)}`,
  )
}

const RUTAS = rutasDeApi().filter((ruta) => ruta !== RUTA_DE_LOGIN)

test('el recorrido encuentra las rutas de la API y las publicas declaradas existen', () => {
  assert.ok(RUTAS.length > 20, `solo se encontraron ${RUTAS.length} rutas: el recorrido esta roto`)
  for (const publica of RUTAS_PUBLICAS) {
    assert.ok(RUTAS.includes(publica), `${publica} ya no existe: la lista de publicas quedo vieja`)
  }
})

test('sin sesion no hay una sola ruta que entregue datos, salvo las dos publicas', async () => {
  sesion = null

  for (const ruta of RUTAS) {
    if (RUTAS_PUBLICAS.has(ruta)) continue
    for (const handler of await metodosDe(ruta)) {
      await assertRechazo(await invocar(handler), `${handler.metodo} ${ruta} sin sesion`)
    }
  }
})

test('a un operador sin ninguna seccion no le responde ninguna ruta con permiso', async () => {
  sesion = OPERADOR_SIN_SECCIONES

  for (const ruta of RUTAS) {
    if (RUTAS_PUBLICAS.has(ruta)) continue
    for (const handler of await metodosDe(ruta)) {
      if (ABIERTAS_A_CUALQUIER_SESION.has(`${ruta} ${handler.metodo}`)) continue
      await assertRechazo(await invocar(handler), `${handler.metodo} ${ruta} con sesion sin secciones`)
    }
  }
})

test('el enlace del consultorio no sirve con un token inventado, ni acompanado de sesion', async () => {
  // Estas rutas no van por sesion sino por el token del enlace del medico: da
  // igual quien pregunte, con un token que no vale no se llama a ningun
  // paciente ni se cierra la atencion de nadie.
  // Sin barra al final: la raiz es `app/api/consultorio` desde que el token
  // salio de la ruta, y las cinco cuelgan de ahi.
  const delConsultorio = RUTAS.filter((ruta) => ruta.startsWith('app/api/consultorio'))
  assert.ok(delConsultorio.length >= 5, 'faltan rutas del consultorio por comprobar')

  /*
    TRES MANERAS DE NO TENER PERMISO, Y LAS TRES SE COMPRUEBAN.

    El token ya no viaja en la ruta sino por cookie o por cabecera, asi que
    "sin token" dejo de ser el unico caso: hay que probar tambien que un token
    inventado por cualquiera de esas dos vias se rechaza igual. Si no, el dia
    que alguien invierta una condicion en el lector de la cookie el barrido
    seguiria en verde, porque solo estaria probando la peticion vacia.
  */
  const credenciales = [
    {},
    { cookie: 'turnos_consultorio=token-inventado' },
    { 'x-consultorio-token': 'token-inventado' },
  ]

  for (const quien of [null, OPERADOR_SIN_SECCIONES]) {
    sesion = quien
    for (const ruta of delConsultorio) {
      for (const handler of await metodosDe(ruta)) {
        for (const cabeceras of credenciales) {
          await assertRechazo(
            await invocar(handler, cabeceras),
            `${handler.metodo} ${ruta} con ${JSON.stringify(cabeceras)}`,
          )
        }
      }
    }
  }
})

test('el historico de un operador sin secciones no deja ver los turnos de otra ventanilla', async () => {
  const servicio = await turnoRepository.crearServicio({
    nombre: 'Facturacion autorizacion',
    prefijo: 'AU',
    modoFila: 'COMPARTIDA',
    activo: true,
  })
  const modulo = await turnoRepository.crearModulo({
    nombre: 'Ventanilla autorizacion',
    servicioId: servicio.id,
    activo: true,
  })
  const turno = await turnoRepository.generarTurnoDeVentanilla(servicio.id)
  await turnoRepository.llamarSiguiente({
    servicioId: servicio.id,
    moduloId: modulo.id,
    funcionarioId: 'usr-otra-ventanilla',
  })

  sesion = OPERADOR_SIN_SECCIONES
  const { GET } = await import('@/app/api/turnos/historico/route')

  // Ni preguntando de frente, ni nombrando en la query al funcionario ajeno.
  //
  // Antes esta ruta pedia ROL y respondia 200 con la lista recortada a lo que
  // el propio funcionario hubiera llamado. No filtraba nada, pero una seccion
  // retirada contestando 200 esconde quien puede entrar de verdad: ahora pide
  // SECCION, como el resto del sistema, y a quien no tiene ninguna lo rechaza
  // de entrada.
  for (const busqueda of ['', '?funcionarioId=usr-otra-ventanilla']) {
    const respuesta = await GET(new Request(`http://localhost/api/turnos/historico${busqueda}`))
    await assertRechazo(respuesta, `historico sin secciones (${busqueda || 'sin filtro'})`)
  }

  // Y quien SI tiene una seccion de turnos entra, pero solo ve lo suyo: el
  // recorte por funcionario sigue en pie para quien no administra.
  sesion = {
    user: { id: 'usr-con-operador', rol: 'OPERADOR', secciones: ['/operador'], nombre: 'Ventanilla' },
  }
  const suyo = await GET(new Request('http://localhost/api/turnos/historico'))
  assert.equal(suyo.status, 200)
  const { turnos } = await suyo.json()
  assert.ok(
    !turnos.map((t) => t.codigo).includes(turno.codigo),
    'un operador vio un turno que llamo otra ventanilla',
  )
})

test('las dos rutas publicas siguen abiertas y sin un solo dato del paciente', async () => {
  sesion = null

  const pantalla = await import('@/app/api/turnos/pantalla/route')
  const respuesta = await pantalla.GET()
  assert.equal(respuesta.status, 200, 'el televisor de la sala de espera no puede quedarse en blanco')
  const contenido = JSON.stringify(await respuesta.json())
  for (const prohibido of ['nombrePaciente', 'documentoPaciente']) {
    assert.ok(!contenido.includes(prohibido), `la pantalla publica expuso ${prohibido}`)
  }

  const stream = await import('@/app/api/turnos/stream/route')
  const eventos = await stream.GET()
  assert.equal(eventos.status, 200)
  assert.match(eventos.headers.get('content-type'), /text\/event-stream/)
  // Se cierra: el servidor tiene que soltar la suscripcion y el latido.
  await eventos.body.cancel()
})

test('la carga de la agenda la puede hacer el operador, no solo el administrador', async () => {
  // Es lo primero que se hace al abrir el hospital. Si solo la pudiera hacer el
  // administrador, el dia que no llegue temprano no habria agenda y nadie
  // podria registrar una llegada. La prueba de barrido de arriba ya comprueba
  // lo contrario (que un operador SIN secciones queda fuera); esta fija que el
  // operador normal SI entra.
  const { POST } = await import('@/app/api/turnos/citas/importar/route')

  const pedir = () =>
    POST(
      new Request('http://localhost/api/turnos/citas/importar', {
        method: 'POST',
        body: new FormData(),
      }),
    )

  for (const rol of ['ADMINISTRADOR', 'OPERADOR']) {
    sesion = { user: { id: `usr-${rol}`, rol, secciones: null, nombre: rol } }
    const respuesta = await pedir()

    // 400 por venir sin archivo, NO 403: el permiso paso y lo que falta es el
    // adjunto. Un 403 aqui significaria que la pantalla muestra el boton y la
    // carga le falla.
    assert.equal(respuesta.status, 400, `${rol} deberia poder cargar la agenda`)
    assert.match((await respuesta.json()).error, /archivo/i)
  }
})

test('el enlace vigente lo puede ver el operador al que se le dio la seccion, no solo el administrador', async () => {
  // Quien reparte los enlaces es el mostrador, no el administrador: el doctor
  // llega a su turno y ahi mismo necesita el suyo. Si ver el enlace vigente
  // fuera solo del administrador, el operador que perdio el mensaje no tendria
  // mas salida que generar otro —y eso revoca el que el doctor esta usando—.
  //
  // El barrido de arriba ya fija lo contrario (un operador SIN secciones queda
  // fuera); esta fija quien SI entra, y que el que no tiene esa seccion no.
  const { GET } = await import('@/app/api/profesionales/[id]/acceso/enlace/route')

  const pedir = () =>
    GET(new Request('http://localhost/api/profesionales/pro-perez/acceso/enlace'), {
      params: Promise.resolve({ id: 'pro-perez' }),
    })

  const conPermiso = [
    { id: 'usr-admin', rol: 'ADMINISTRADOR', secciones: null, nombre: 'Admin' },
    // Operador al que le dieron Enlaces de consultorio y nada mas.
    { id: 'usr-op', rol: 'OPERADOR', secciones: ['/admin/enlaces'], nombre: 'Operador' },
  ]

  for (const user of conPermiso) {
    sesion = { user }
    const respuesta = await pedir()
    // 404 porque ese doctor no tiene enlace vivo en esta prueba, NO 403: el
    // permiso paso y lo que falta es el enlace.
    assert.equal(respuesta.status, 404, `${user.rol} deberia poder consultar el enlace`)
  }

  // Y el operador al que NO se le dio esa seccion sigue fuera.
  sesion = { user: { id: 'usr-otro', rol: 'OPERADOR', secciones: ['/operador'], nombre: 'Otro' } }
  assert.equal((await pedir()).status, 403, 'un operador sin la seccion no puede ver enlaces')
})

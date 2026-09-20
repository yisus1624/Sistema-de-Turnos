/**
 * Siembra lo minimo para que el sistema arranque contra una base vacia:
 * la configuracion general y las dos cuentas semilla.
 *
 * NO SIEMBRA CATALOGO. Los servicios, los consultorios y los doctores salen del
 * reporte de citas del hospital la primera vez que se carga (ver
 * `lib/citas/importar-reporte.ts`). Sembrar unos de ejemplo aqui dejaria al
 * administrador con doctores inventados mezclados con los de verdad, y sin
 * forma facil de distinguirlos.
 *
 * Es IDEMPOTENTE: se puede correr las veces que haga falta. Si una cuenta ya
 * existe no se toca, y en particular NO se le reescribe la contrasena: eso
 * borraria en silencio la que el hospital haya puesto.
 *
 *   npm run db:seed
 */
// La extension va explicita: el seed corre con `node --experimental-strip-types`,
// que resuelve como ESM y no adivina extensiones como hace el bundler.
import { cifrarContrasena } from '../lib/usuarios/contrasenas.ts'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const CONFIGURACION = {
  audioActivo: true,
  volumen: 1,
  ultimosVisibles: 5,
  mensajePie: 'Bienvenido a la ESE Hospital San Rafael de Chinu. Por favor espere a ser llamado.',
  duracionCitaMinutos: 15,
  jornadaMananaInicio: '07:00',
  jornadaMananaFin: '12:00',
  jornadaTardeInicio: '13:00',
  jornadaTardeFin: '17:00',
}

async function sembrarConfiguracion() {
  await prisma.configuracion.upsert({
    where: { id: 'unica' },
    update: {},
    create: { id: 'unica', ...CONFIGURACION },
  })
  console.log('configuracion: lista')
}

async function sembrarCuenta(params: {
  nombre: string
  usuario: string
  password: string
  rol: 'ADMINISTRADOR' | 'OPERADOR'
  area: string
}) {
  const usuario = params.usuario.trim().toLowerCase()

  /*
    SE MIRA SI YA HAY ALGUIEN CON ESE ROL, NO SOLO CON ESE NOMBRE.

    Desde que una cuenta se puede RENOMBRAR, buscar por nombre de entrada no
    alcanza: si el administrador cambia su usuario de "admin" a otro, el
    siguiente `db:seed` no encontraria "admin", lo daria por perdido y crearia
    un SEGUNDO administrador con la contrasena del entorno —una cuenta con
    acceso total que nadie pidio y que nadie esta mirando—. El seed existe para
    que haya una primera cuenta de cada rol, no para garantizar un nombre.
  */
  const existente = await prisma.usuario.findFirst({
    where: { OR: [{ usuario }, { rol: params.rol }] },
    select: { usuario: true },
  })

  if (existente) {
    console.log(`usuario "${existente.usuario}" (${params.rol}): ya existe, no se toca`)
    return
  }

  await prisma.usuario.create({
    data: {
      nombre: params.nombre,
      usuario,
      passwordHash: await cifrarContrasena(params.password),
      rol: params.rol,
      area: params.area,
      activo: true,
      secciones: [],
    },
  })
  console.log(`usuario "${usuario}": creado`)
}

/**
 * Longitud minima exigida a una contrasena semilla en produccion.
 *
 * Doce, no las ocho que pide la pantalla de usuarios: estas dos cuentas no son
 * una mas. La de ADMINISTRADOR abre la agenda completa, los documentos de los
 * pacientes y la gestion de usuarios, se crea una sola vez y casi nadie vuelve
 * a mirarla. El minimo de ocho es para el funcionario que cambia su clave y la
 * escribe todos los dias; esta se pone una vez en un archivo de entorno, asi
 * que exigir mas no le cuesta trabajo a nadie.
 */
const MINIMO_CARACTERES = 12

const enProduccion = process.env.NODE_ENV === 'production'

/**
 * La contrasena semilla de una cuenta, o un error que para el sembrado.
 *
 * EN PRODUCCION NO HAY VALOR POR DEFECTO, Y ESE ES EL ARREGLO. Antes, correr
 * `npm run db:seed` en el servidor sin exportar las variables dejaba una cuenta
 * de administrador con una contrasena que esta escrita en este repositorio:
 * acceso total a la agenda y a los datos de los pacientes sin explotar nada, y
 * sin que nada avisara. Un aviso en un comentario no impide un despliegue; un
 * error si.
 *
 * Fuera de produccion el valor por defecto sigue, a proposito: levantar un
 * equipo de desarrollo tiene que ser sin friccion, y ahi la base es de mentira.
 */
function contrasenaSemilla(variable: string, porDefecto: string): string {
  const declarada = process.env[variable]?.trim()

  if (!enProduccion) return declarada || porDefecto

  if (!declarada) {
    throw new Error(
      `Falta la variable ${variable}. En produccion las contrasenas de las cuentas semilla ` +
        'no pueden salir del codigo: la que trae este repositorio es publica y dejaria una ' +
        'cuenta de administrador abierta a cualquiera. Definela en el entorno del servidor y ' +
        'vuelve a ejecutar "npm run db:seed".',
    )
  }

  if (declarada === porDefecto) {
    throw new Error(
      `La variable ${variable} trae la contrasena de ejemplo del repositorio, que es publica. ` +
        'Pon una contrasena propia antes de sembrar la base del hospital.',
    )
  }

  if (declarada.length < MINIMO_CARACTERES) {
    throw new Error(
      `La contrasena de ${variable} es demasiado corta: necesita al menos ${MINIMO_CARACTERES} ` +
        'caracteres. Esta cuenta se crea una vez y casi nadie vuelve a revisarla, asi que es la ' +
        'que mas aguanta tener que ser larga.',
    )
  }

  return declarada
}

async function main() {
  // LAS CREDENCIALES SE RESUELVEN ANTES DE TOCAR LA BASE. Si falta alguna, el
  // seed se corta sin haber escrito nada: quien despliega arregla el entorno y
  // vuelve a correrlo sobre una base intacta.
  const credenciales = {
    administrador: contrasenaSemilla('TURNOS_ADMIN_PASSWORD', 'admin1234'),
    operador: contrasenaSemilla('TURNOS_OPERADOR_PASSWORD', 'operador1234'),
  }

  await sembrarConfiguracion()

  await sembrarCuenta({
    nombre: 'Administrador del sistema',
    usuario: process.env.TURNOS_ADMIN_USUARIO ?? 'admin',
    password: credenciales.administrador,
    rol: 'ADMINISTRADOR',
    area: 'Sistemas',
  })

  await sembrarCuenta({
    nombre: 'Operador de admisiones',
    usuario: process.env.TURNOS_OPERADOR_USUARIO ?? 'operador',
    password: credenciales.operador,
    rol: 'OPERADOR',
    area: 'Admisiones',
  })
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })

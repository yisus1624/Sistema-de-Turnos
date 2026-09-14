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
import bcrypt from 'bcryptjs'
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
  const existente = await prisma.usuario.findUnique({ where: { usuario }, select: { id: true } })

  if (existente) {
    console.log(`usuario "${usuario}": ya existe, no se toca`)
    return
  }

  await prisma.usuario.create({
    data: {
      nombre: params.nombre,
      usuario,
      passwordHash: bcrypt.hashSync(params.password, 10),
      rol: params.rol,
      area: params.area,
      activo: true,
      secciones: [],
    },
  })
  console.log(`usuario "${usuario}": creado`)
}

async function main() {
  await sembrarConfiguracion()

  // Las credenciales salen del entorno. Los valores por defecto son publicos y
  // estan en el codigo: sirven para levantar el sistema en un equipo de
  // desarrollo, y hay que cambiarlos ANTES de ponerlo en la red del hospital
  // (ver `.env.example`).
  await sembrarCuenta({
    nombre: 'Administrador del sistema',
    usuario: process.env.TURNOS_ADMIN_USUARIO ?? 'admin',
    password: process.env.TURNOS_ADMIN_PASSWORD ?? 'admin1234',
    rol: 'ADMINISTRADOR',
    area: 'Sistemas',
  })

  await sembrarCuenta({
    nombre: 'Operador de admisiones',
    usuario: process.env.TURNOS_OPERADOR_USUARIO ?? 'operador',
    password: process.env.TURNOS_OPERADOR_PASSWORD ?? 'operador1234',
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

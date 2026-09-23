/**
 * Cliente Prisma. SOLO servidor.
 *
 * `server-only` es la barrera: si un componente de cliente llega hasta aqui
 * (aunque sea de forma indirecta, a traves de un modulo de `lib/`), la
 * compilacion falla senalando el archivo culpable. Sin esa linea el fallo no
 * aparece al compilar: Prisma se empaqueta para el navegador, `new
 * PrismaClient()` se ejecuta al hidratar y la pagina entera muere sin ninguna
 * pista de por que.
 *
 * REINTENTOS. El servidor de Supabase corta las conexiones inactivas y de vez
 * en cuando tarda unos segundos en responder. Cuando eso cae en mitad de un
 * render, Prisma lanza un error de CONEXION —no de datos: la consulta nunca
 * llego a ejecutarse— y la pantalla se sirve rota aunque la base este sana un
 * instante despues. En un mostrador de hospital eso se lee como "el sistema se
 * cayo". Reintentar con una espera corta convierte el corte pasajero en una
 * peticion normal.
 *
 * Solo se reintentan LECTURAS, salvo cuando consta que la consulta no llego a
 * salir: repetir una escritura podria registrar dos veces la llegada de un
 * paciente o generarle dos turnos.
 */
import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Prisma, PrismaClient } from '@prisma/client'

/**
 * Marca "esto corre dentro de una transaccion interactiva".
 *
 * Dentro de una transaccion NO se reintenta nada, ni siquiera una lectura: si
 * la conexion se corto (P1017), la transaccion entera ya se perdio con ella, y
 * repetir la lectura solo alarga el fallo. La pone `enTransaccion` en el
 * repositorio; el reintento de abajo la consulta.
 */
export const contextoDeTransaccion = new AsyncLocalStorage<true>()

const CODIGOS_CONEXION = new Set([
  'P1001', // no se puede alcanzar el servidor
  'P1002', // el servidor rechazo la conexion por timeout
  'P1008', // timeout al abrir la conexion
  'P1017', // el servidor cerro la conexion
  'P2024', // timeout esperando una conexion libre del pool
])

const MENSAJES_CONEXION = [
  /can't reach database server/i,
  /server has closed the connection/i,
  /connection (closed|terminated|reset)/i,
  /timed out fetching a new connection/i,
  /econnreset|econnrefused|etimedout|enotfound|eai_again/i,
]

/** Operaciones sin efectos secundarios: las unicas que se pueden repetir. */
const SOLO_LECTURA = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'aggregate',
  'count',
  'groupBy',
  // `$queryRaw` NO: en este sistema se usa para candados (`FOR UPDATE`,
  // `pg_advisory_xact_lock`) dentro de transacciones, y repetirlo tras un corte
  // no tiene sentido: la transaccion ya se perdio con la conexion.
])

/** Errores en los que la consulta con seguridad no llego a ejecutarse. */
function fallaAntesDeEjecutar(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P1001' || error.code === 'P1002' || error.code === 'P2024'
  }
  return false
}

function esCorteDeConexion(error: unknown): boolean {
  if (fallaAntesDeEjecutar(error)) return true
  if (error instanceof Prisma.PrismaClientKnownRequestError && CODIGOS_CONEXION.has(error.code)) {
    return true
  }
  const mensaje = error instanceof Error ? error.message : ''
  return MENSAJES_CONEXION.some((patron) => patron.test(mensaje))
}

/** 4 intentos con espera que se dobla: ~3.5s en total. */
const INTENTOS = 4
const ESPERA_BASE_MS = 500

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function crearCliente() {
  return new PrismaClient({ datasourceUrl: process.env.DATABASE_URL }).$extends({
    query: {
      async $allOperations({ operation, args, query }) {
        let ultimoError: unknown

        for (let intento = 1; intento <= INTENTOS; intento += 1) {
          try {
            return await query(args)
          } catch (error) {
            ultimoError = error

            const reintentable =
              !contextoDeTransaccion.getStore() &&
              (fallaAntesDeEjecutar(error) || (SOLO_LECTURA.has(operation) && esCorteDeConexion(error)))

            if (!reintentable || intento === INTENTOS) throw error

            console.warn(
              `[prisma] ${operation} fallo por conexion (intento ${intento}/${INTENTOS}). Reintentando.`,
              error instanceof Error ? error.message.split('\n')[0] : error,
            )
            await esperar(ESPERA_BASE_MS * 2 ** (intento - 1))
          }
        }

        throw ultimoError
      },
    },
  })
}

const globalParaPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

/**
 * Se expone con el tipo `PrismaClient` original. La extension solo envuelve la
 * ejecucion —no agrega ni quita modelos ni campos—, y dejarla fuera del tipo
 * evita que `$transaction` y `Prisma.TransactionClient` dejen de encajar en el
 * codigo que use el cliente.
 */
export const prisma: PrismaClient =
  globalParaPrisma.prisma ?? (crearCliente() as unknown as PrismaClient)

if (process.env.NODE_ENV !== 'production') globalParaPrisma.prisma = prisma

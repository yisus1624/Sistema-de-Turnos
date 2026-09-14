/**
 * EL UNICO SITIO DONDE SE ELIGE DE DONDE SALEN LOS DATOS.
 *
 * Todo el sistema —rutas de API, servicios de dominio— importa `turnoRepository`
 * DE AQUI, y lo recibe tipado como el contrato `TurnoRepository`, nunca como la
 * clase concreta que hoy lo cumple.
 *
 * POR QUE EXISTE ESTE ARCHIVO. Antes cada ruta importaba directamente
 * `./in-memory-repository`: treinta y un archivos atados a la implementacion de
 * pruebas. Conectar la API del hospital significaba entonces editar los treinta
 * y uno, y cualquiera que se quedara sin cambiar seguiria leyendo y escribiendo
 * en la memoria del proceso SIN DAR NINGUN ERROR: la pantalla mostraria unos
 * turnos y la agenda otros, o el paciente registrado en admisiones no le
 * aparecerian al doctor. Un fallo silencioso y a medias es lo peor que puede
 * pasar en el arranque de un sistema de turnos de un hospital.
 *
 * Ahora el cambio es de UNA linea, aqui.
 *
 * Y como lo que se exporta esta tipado con la interfaz y no con la clase, el
 * compilador impide que una ruta llame a un metodo que solo existe en la
 * implementacion en memoria: si lo hiciera, ese metodo faltaria el dia que se
 * conecte la API de verdad, y no habria forma de enterarse hasta produccion.
 *
 * CUANDO LLEGUE LA API DEL HOSPITAL (ver `lib/hospital/README.md`): se escribe
 * el adaptador que implementa `TurnoRepository` contra ella y se cambia la
 * asignacion de abajo. Nada mas del sistema se toca.
 */
import { turnoRepository as enPostgres } from './prisma-repository'
import type { TurnoRepository } from './repository'

/**
 * FUENTE ACTUAL: PostgreSQL (Supabase), via `prisma-repository`.
 *
 * Hasta aqui los datos vivian en la memoria del proceso y se perdian en cada
 * reinicio: servia para el demo, pero un hospital no puede perder la agenda del
 * dia porque se reinicio el servidor. La implementacion en memoria SIGUE en el
 * repositorio (`in-memory-repository.ts`) y cumple el mismo contrato, asi que
 * cambiar esta linea la devuelve entera para desarrollar sin base de datos.
 */
export const turnoRepository: TurnoRepository = enPostgres

export type { TurnoRepository }

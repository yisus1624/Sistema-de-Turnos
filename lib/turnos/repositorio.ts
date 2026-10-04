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
import { mundoActual } from '@/lib/demostracion/mundo'
import type { TurnoRepository } from './repository'

/**
 * FUENTE ACTUAL: PostgreSQL (Supabase), via `prisma-repository`... SALVO PARA
 * LA CUENTA DE DEMOSTRACION.
 *
 * Cada llamada pregunta primero de que mundo es la peticion (ver
 * `lib/demostracion/mundo.ts`): una sesion de demostracion, o un enlace de
 * doctor de demostracion, va al hospital de mentira en memoria; todo lo demas
 * —y cualquier duda— a la base real. Las rutas no se enteran: siguen
 * importando este `turnoRepository` y hablando con el mismo contrato.
 *
 * Funciona porque TODO el contrato es asincrono: cada metodo devuelve una
 * promesa, asi que elegir el mundo antes de llamarlo no cambia nada para
 * quien llama.
 */
export const turnoRepository: TurnoRepository = new Proxy({} as TurnoRepository, {
  get(_, metodo) {
    // Que no parezca una promesa (`then`) ni otra cosa que un repositorio.
    if (typeof metodo !== 'string' || metodo === 'then') return undefined
    return async (...argumentos: unknown[]) => {
      const { repositorio } = await mundoActual()
      const elegido = Reflect.get(repositorio, metodo) as (...a: unknown[]) => Promise<unknown>
      return elegido.apply(repositorio, argumentos)
    }
  },
})

export type { TurnoRepository }

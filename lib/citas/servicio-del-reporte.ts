/**
 * Con que servicio del catalogo se queda cada servicio del reporte.
 *
 * POR QUE HACE FALTA. La carga buscaba el servicio por su nombre EXACTO,
 * mientras que consultorios y doctores se emparejan por `claveExterna`. El
 * administrador puede renombrar servicios, y cada renombre rompia algo: pasar
 * "Consulta externa" a "CONSULTA EXTERNA" hacia que la carga intentara crearlo
 * otra vez y el indice de nombre normalizado lo rechazara (500 en cada subida,
 * el hospital sin agenda); pasar "Odontologia" a "Odontología" creaba en
 * silencio un segundo "Odontologia" con otra letra, y los turnos del
 * odontologo salian como A-001 en el televisor.
 *
 * LA REGLA. Manda la clave, igual que en consultorios y doctores. Los servicios
 * que ya existian no la tienen (la migracion solo pudo rellenar los que no
 * dejaban dudas), asi que el primero que se llame como el del reporte SIN
 * distinguir mayusculas, tildes ni espacios se queda con ella; desde entonces
 * su nombre ya no importa. Solo se crea un servicio si de verdad no hay
 * ninguno.
 *
 * Es puro, como `plan-de-carga.ts`: decide sobre el catalogo que se le pasa y
 * no escribe nada. Escribir es trabajo de `importar-reporte.ts`.
 */
import { claveDe, type ServicioDerivado } from './reporte-hospital'

/** Un servicio del catalogo, en lo que hace falta para decidir. */
export interface ServicioDelCatalogo {
  id: string
  nombre: string
  prefijo: string
  activo: boolean
  claveExterna: string | null
}

export type DecisionDeServicio =
  | { accion: 'usar'; id: string }
  /** Existe pero sin clave: hay que ponersela antes de usarlo. */
  | { accion: 'adoptar'; id: string }
  | { accion: 'crear' }

export function decidirServicio(servicio: ServicioDerivado, catalogo: ServicioDelCatalogo[]): DecisionDeServicio {
  const conLaClave = catalogo.find((existente) => existente.claveExterna === servicio.clave)
  if (conLaClave) return { accion: 'usar', id: conLaClave.id }

  const [adoptable] = mismoNombreSinClave(servicio, catalogo)
  return adoptable ? { accion: 'adoptar', id: adoptable.id } : { accion: 'crear' }
}

/**
 * Los que se llaman como el del reporte y todavia no son de nadie, el mas
 * probable primero. El orden es estable: a igualdad, el primero del catalogo.
 */
function mismoNombreSinClave(servicio: ServicioDerivado, catalogo: ServicioDelCatalogo[]) {
  return catalogo
    .filter((existente) => existente.claveExterna === null && claveDe(existente.nombre) === servicio.clave)
    .sort((a, b) => preferencia(b, servicio) - preferencia(a, servicio))
}

/**
 * Cuando hay mas de uno que se llama igual.
 *
 * Son restos del fallo que duplicaba servicios: el duplicado nacio con otra
 * letra porque la del reporte ya estaba ocupada, asi que el que la conserva es
 * el de siempre, el que tiene a los doctores y el historico. Antes que eso va
 * lo que haya decidido el administrador: si apago uno de los dos, no se le
 * vuelven a mandar citas.
 */
function preferencia(existente: ServicioDelCatalogo, servicio: ServicioDerivado) {
  return (existente.activo ? 2 : 0) + (existente.prefijo === servicio.prefijo ? 1 : 0)
}

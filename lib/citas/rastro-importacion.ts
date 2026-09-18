/**
 * El detalle que deja en el registro de actividad una carga del reporte de
 * citas.
 *
 * Vive fuera de la ruta porque es lo unico de esa carga que hay que poder
 * probar sin subir un archivo: que apunte el catalogo que la carga dio de alta
 * sola y el antes de cada jornada que corrigio.
 */
import type { AjusteDeJornada } from '@/lib/turnos/types'

/**
 * Solo lo que el registro necesita del resumen. No se pide `ResumenCarga`
 * entero para que esto no dependa de campos que no lee (ISP).
 */
export interface ResumenParaElRegistro {
  creadas: number
  actualizadas: number
  omitidas: number
  errores: readonly unknown[]
  fechas: readonly string[]
  serviciosNuevos?: readonly string[]
  consultoriosNuevos: readonly string[]
  profesionalesNuevos: readonly string[]
  jornadasAjustadas: readonly AjusteDeJornada[]
}

export function detalleDeImportacion(resumen: ResumenParaElRegistro): Record<string, unknown> {
  return {
    creadas: resumen.creadas,
    actualizadas: resumen.actualizadas,
    omitidas: resumen.omitidas,
    errores: resumen.errores.length,
    fechas: resumen.fechas,
    // El catalogo que la carga crea sola es lo que despues nadie sabe de donde
    // salio: un consultorio o un doctor que aparecio de un archivo tiene que
    // quedar atado a ese archivo y a quien lo subio.
    ...siHay('serviciosNuevos', resumen.serviciosNuevos ?? []),
    ...siHay('consultoriosNuevos', resumen.consultoriosNuevos),
    ...siHay('profesionalesNuevos', resumen.profesionalesNuevos),
    // Con el anterior delante, un ajuste automatico que salio mal se puede
    // deshacer leyendo el registro. Con solo la jornada nueva, no.
    ...siHay('jornadasAjustadas', resumen.jornadasAjustadas.map(comoCambioDeJornada)),
  }
}

function comoCambioDeJornada(ajuste: AjusteDeJornada): string {
  return `${ajuste.nombre}: ${ajuste.anterior} -> ${ajuste.jornada}`
}

/** Una lista vacia no se escribe: solo alargaria el detalle sin decir nada. */
function siHay(clave: string, lista: readonly string[]): Record<string, readonly string[]> {
  return lista.length > 0 ? { [clave]: lista } : {}
}

/**
 * La forma de un evento del registro de actividad.
 *
 * Vive aparte de `registro.ts` porque la PANTALLA la necesita y `registro.ts`
 * habla con la base de datos. Aunque el import de la pantalla sea de tipo y se
 * borre al compilar, tener el tipo en un archivo sin dependencias de servidor
 * quita de en medio la duda: nadie va a arrastrar Prisma al navegador por
 * querer tipar una tabla.
 */

export interface EventoSeguridad {
  fecha: string
  tipo: string
  exito: boolean
  usuarioId?: string | null
  /**
   * Nombre de quien hizo la accion, copiado en ese momento.
   *
   * Es el dato que se lee: un identificador interno no dice nada al revisar el
   * registro, y resolverlo por relacion contra la tabla de usuarios daria el
   * nombre de HOY —o ninguno, si la cuenta se dio de baja— en vez del de
   * entonces. Va en null cuando la accion no la hizo alguien con sesion, como
   * un intento de entrada fallido.
   */
  usuarioNombre?: string | null
  /** Sobre que se actuo: el usuario afectado, el archivo subido, la cita. */
  identificador?: string | null
  ip?: string | null
  detalle?: Record<string, unknown>
}

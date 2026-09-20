/**
 * Los tipos de evento del registro de actividad, en un solo sitio.
 *
 * Antes eran cadenas sueltas escritas a mano en cada ruta. Un error de tecleo
 * no rompia nada: creaba un tipo nuevo, que salia como una entrada mas en el
 * selector de `/admin/seguridad` y dejaba fuera del filtro los eventos que
 * debia agrupar. Quien audita no tiene forma de notar que le falta la mitad.
 *
 * CONVIVEN DOS FORMAS Y ES A PROPOSITO. La mayoria son MAYUSCULA_SNAKE; tres
 * nacieron despues en minuscula con puntos. El tipo se guarda tal cual en la
 * columna `tipo` de `eventos_seguridad`, asi que renombrarlos ahora dejaria los
 * registros ya escritos apuntando a un nombre que ya no existe: el filtro por
 * tipo no los encontraria y la pantalla los mostraria en crudo. Un registro de
 * auditoria se corrige hacia adelante, nunca reescribiendo lo que paso. Para
 * eventos NUEVOS se usa MAYUSCULA_SNAKE.
 *
 * El archivo no importa nada: lo lee tambien la pantalla, que corre en el
 * navegador.
 */

export const EVENTOS = {
  INICIO_SESION: 'INICIO_SESION',

  USUARIO_CREADO: 'USUARIO_CREADO',
  USUARIO_ACTUALIZADO: 'USUARIO_ACTUALIZADO',

  /**
   * Cambio el NOMBRE DE ENTRADA de una cuenta, no la cuenta.
   *
   * Tiene tipo propio, en vez de quedarse como un campo mas dentro de
   * USUARIO_ACTUALIZADO, porque es el unico cambio que estropea la lectura de
   * lo ya escrito: los eventos anteriores guardan en `identificador` el nombre
   * de entonces, asi que a partir del renombrado hay dos nombres para la misma
   * persona. Este apunte lleva el anterior y el nuevo, y es el puente entre los
   * dos; con tipo propio, ademas, se pueden sacar de golpe todos los
   * renombrados de un periodo.
   */
  USUARIO_RENOMBRADO: 'USUARIO_RENOMBRADO',

  /**
   * Se cambio la contrasena de una cuenta: la propia, o la de otra persona
   * cuando un administrador la restablece.
   *
   * SE APUNTA QUE SE CAMBIO, NUNCA CUAL ES: ni la vieja ni la nueva, ni entera
   * ni en trozos, ni su hash (ver `lib/usuarios/auditoria.ts`). Los intentos
   * FALLIDOS tambien se apuntan; alguien probando contrasenas contra una sesion
   * abierta es justo lo que hay que poder revisar despues.
   */
  USUARIO_CONTRASENA_CAMBIADA: 'USUARIO_CONTRASENA_CAMBIADA',

  ACCESO_PROFESIONAL: 'ACCESO_PROFESIONAL',
  ACCESO_PROFESIONAL_GENERADO: 'ACCESO_PROFESIONAL_GENERADO',
  ACCESO_PROFESIONAL_REVOCADO: 'ACCESO_PROFESIONAL_REVOCADO',
  /**
   * Alguien volvio a mirar un enlace ya generado.
   *
   * Se apunta porque el enlace es una llave que abre la agenda con nombres de
   * pacientes sin pedir contrasena: quien pudo tenerla en la mano es parte de
   * la respuesta a "¿quien entro a ese consultorio?", y sin esto solo quedaba
   * registrado quien la genero, no quien la copio despues.
   */
  ACCESO_PROFESIONAL_CONSULTADO: 'ACCESO_PROFESIONAL_CONSULTADO',

  CITA_CREADA: 'CITA_CREADA',
  CITA_CANCELADA: 'CITA_CANCELADA',
  CITA_REPROGRAMADA: 'CITA_REPROGRAMADA',
  LLEGADA_REGISTRADA: 'LLEGADA_REGISTRADA',

  TURNO_GENERADO: 'TURNO_GENERADO',
  TURNO_LLAMADO: 'TURNO_LLAMADO',
  TURNO_REPETIDO: 'TURNO_REPETIDO',
  TURNO_ATENDIDO: 'TURNO_ATENDIDO',
  TURNO_AUSENTE: 'TURNO_AUSENTE',

  SERVICIO_CREADO: 'SERVICIO_CREADO',
  SERVICIO_ACTUALIZADO: 'SERVICIO_ACTUALIZADO',
  SERVICIO_ELIMINADO: 'SERVICIO_ELIMINADO',
  MODULO_CREADO: 'MODULO_CREADO',
  MODULO_ACTUALIZADO: 'MODULO_ACTUALIZADO',
  PROFESIONAL_CREADO: 'PROFESIONAL_CREADO',
  PROFESIONAL_ACTUALIZADO: 'PROFESIONAL_ACTUALIZADO',

  /**
   * Se rechazo una conexion al canal en vivo por aforo lleno (ver
   * `lib/realtime/aforo.ts`). Si empiezan a aparecer, o el hospital tiene mas
   * pantallas de las previstas o alguien esta abriendo conexiones a mano.
   */
  CANAL_EN_VIVO_RECHAZADO: 'CANAL_EN_VIVO_RECHAZADO',

  CONFIGURACION_ACTUALIZADA: 'CONFIGURACION_ACTUALIZADA',
  SIMULACION_REINICIO_DEL_DIA: 'SIMULACION_REINICIO_DEL_DIA',

  // --- Los tres nombres antiguos en minuscula. Ver la nota de arriba. ---
  CITAS_IMPORTADAS: 'citas.importadas',
  CITAS_DATOS_PURGADOS: 'citas.datos.purgados',
  JORNADAS_RECALCULADAS: 'profesionales.jornadas.recalculadas',
} as const

export type TipoEvento = (typeof EVENTOS)[keyof typeof EVENTOS]

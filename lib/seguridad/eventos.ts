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

  ACCESO_PROFESIONAL: 'ACCESO_PROFESIONAL',
  ACCESO_PROFESIONAL_GENERADO: 'ACCESO_PROFESIONAL_GENERADO',
  ACCESO_PROFESIONAL_REVOCADO: 'ACCESO_PROFESIONAL_REVOCADO',

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

  CONFIGURACION_ACTUALIZADA: 'CONFIGURACION_ACTUALIZADA',
  SIMULACION_REINICIO_DEL_DIA: 'SIMULACION_REINICIO_DEL_DIA',

  // --- Los tres nombres antiguos en minuscula. Ver la nota de arriba. ---
  CITAS_IMPORTADAS: 'citas.importadas',
  CITAS_DATOS_PURGADOS: 'citas.datos.purgados',
  JORNADAS_RECALCULADAS: 'profesionales.jornadas.recalculadas',
} as const

export type TipoEvento = (typeof EVENTOS)[keyof typeof EVENTOS]

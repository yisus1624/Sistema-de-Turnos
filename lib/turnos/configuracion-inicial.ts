/**
 * Con que valores arranca la configuracion del sistema.
 *
 * UNA SOLA FUENTE DE VERDAD, a proposito. Estos mismos valores estaban
 * copiados en el repositorio de memoria, en el de base de datos y en la
 * pantalla del televisor, y ya habian empezado a separarse: el volumen valia 1
 * en el codigo y 0.8 en la columna de la base, asi que el televisor arrancaba
 * sonando a un volumen y la administracion mostraba otro. En una pantalla cuyo
 * unico aviso al paciente es la campanita, que el volumen dependa de por donde
 * se mire no es un detalle.
 *
 * Es un dato puro del dominio: no sabe de Prisma, ni de React, ni de Next.
 */
import type { ConfiguracionSistema } from './types'

export const CONFIGURACION_INICIAL: ConfiguracionSistema = {
  audioActivo: true,
  volumen: 1,
  mensajePie: 'Bienvenido a la ESE Hospital San Rafael de Chinu. Por favor espere a ser llamado.',
  // El televisor arranca con el diseño de siempre: cambiarle el aspecto a las
  // salas no puede ser el efecto secundario de una actualizacion, tiene que
  // ser una decision que alguien tome en "Pantalla y audio".
  disenoPantalla: 'CUADRICULA',
  // La imagen institucional que el hospital entrego para la sala de espera.
  // Dejarla vacia tambien vale: las dos pantallas se ven correctas sin fondo,
  // porque la imagen es un adorno y nunca sostiene informacion.
  fondoPantalla: '/img/fondo-pantalla.png',
  // Jornadas y duracion de consulta tipicas del hospital. El administrador las
  // cambia desde "Pantalla y audio"; de aqui sale la parrilla del horario.
  duracionCitaMinutos: 15,
  jornadaMananaInicio: '07:00',
  jornadaMananaFin: '12:00',
  jornadaTardeInicio: '13:00',
  jornadaTardeFin: '17:00',
}

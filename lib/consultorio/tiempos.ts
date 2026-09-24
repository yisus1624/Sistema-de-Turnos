import { msPeorCasoDelLlamado } from '@/lib/api/llamado-cliente'

/**
 * Cuanto puede durar como maximo una accion del doctor antes de darla por perdida.
 *
 * El refresco automatico se salta mientras el doctor esta ejecutando una
 * accion, para no pisarle la pantalla a media operacion. Si una peticion se
 * queda colgada (la red se fue justo ahi) y nadie suelta esa marca, la pantalla
 * deja de actualizarse para el resto de la jornada. Pasado este tiempo se
 * libera y el refresco continua. Va por encima del peor caso de "Llamar
 * siguiente" con reintentos: soltarlo antes dejaria pulsar dos veces.
 */
export const MS_MAXIMO_POR_ACCION = msPeorCasoDelLlamado() + 5000

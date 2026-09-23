/**
 * LOS AZULES DE LA PIEZA APROBADA.
 *
 * El resto del sistema usa el teal institucional (`brand`, en
 * tailwind.config.ts); la cartelera se aparta a proposito, porque el hospital
 * la aprobo con estos azules y es lo que espera ver en la sala. Viven aqui, y
 * no sueltos por el marcado, para que unificarlos algun dia con el teal sea
 * tocar este archivo y no cazarlos uno a uno.
 */
export const AZUL_PROFUNDO = '#0B3B7A'
export const AZUL_MEDIO = '#1B5FC1'
export const AZUL_CLARO = '#EFF5FD'

/**
 * El fondo de la fila del turno en curso: el azul medio apenas oscurecido.
 * Con el azul medio, el texto blanco quedaba en 6:1; con este llega a 7,4:1,
 * lo que pide una letra que se lee desde el fondo de la sala y por personas
 * con baja vision.
 */
export const AZUL_FILA_ACTUAL = '#1852AA'

/** Las filas anteriores: casi blancas, para que la actual sea la unica de color. */
export const FONDO_FILA = '#FBFCFE'

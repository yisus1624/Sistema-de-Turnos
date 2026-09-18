/**
 * Como se guardan y se comprueban las contraseñas de los funcionarios.
 *
 * DOS DECISIONES, LAS DOS EN UN SOLO SITIO porque las cumplen las dos
 * implementaciones del repositorio de usuarios y antes estaban copiadas en las
 * dos, con el coste escrito a mano en cuatro llamadas.
 *
 * 1. COSTE 12, NO 10. El coste es cuanto trabajo cuesta probar UNA contraseña:
 *    cada punto lo dobla. Con 10, quien se lleve una copia de la base puede
 *    probar muchas mas por segundo. Estas cuentas abren la agenda de un
 *    hospital con nombres y documentos de pacientes; el coste 12 encarece por
 *    cuatro cualquier intento de adivinarlas y le añade unos pocos cientos de
 *    milisegundos a un inicio de sesion, que se hace una vez por jornada.
 *
 *    LAS CONTRASEÑAS QUE YA ESTAN GUARDADAS siguen con coste 10 y se siguen
 *    comprobando bien: bcrypt lleva el coste dentro del propio hash. Cada una
 *    pasa a 12 cuando su dueño la cambie. No se fuerza una migracion: obligar
 *    al hospital entero a cambiar de clave a la vez tiene su propio riesgo.
 *
 * 2. ASINCRONAS, NO `hashSync`/`compareSync`. La version sincrona BLOQUEA el
 *    hilo de Node mientras calcula, y con coste 12 eso son cientos de
 *    milisegundos en los que el servidor no atiende NADA: ni la pantalla de la
 *    sala de espera, ni el llamado de un turno, ni la busqueda de admisiones.
 *    Un solo servidor atiende a todo el hospital, asi que un inicio de sesion
 *    no puede congelarlo.
 */
import bcrypt from 'bcryptjs'

/**
 * Coste de calculo del hash. Ver la nota de arriba antes de cambiarlo: subirlo
 * encarece cada inicio de sesion, bajarlo abarata adivinar las contraseñas.
 */
const COSTE = 12

export function cifrarContrasena(password: string): Promise<string> {
  return bcrypt.hash(password, COSTE)
}

/**
 * La version que bloquea, SOLO para sembrar las cuentas de ejemplo.
 *
 * El repositorio en memoria crea sus dos cuentas al cargarse el modulo, antes
 * de que el servidor atienda nada, y ahi no hay ningun `await` posible ni nadie
 * esperando: bloquear unos milisegundos una vez no le quita tiempo a nadie. En
 * cualquier otro sitio va la asincrona, por lo que dice la nota de arriba.
 */
export function cifrarContrasenaAlSembrar(password: string): string {
  return bcrypt.hashSync(password, COSTE)
}

/**
 * Si la contraseña coincide con el hash guardado.
 *
 * Funciona con hashes de cualquier coste, incluidos los que se crearon con 10:
 * bcrypt lo lee del propio hash.
 */
export function contrasenaCoincide(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

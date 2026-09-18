/**
 * Quien puede hacerle que a la cuenta de quien.
 *
 * POR QUE ESTA REGLA VIVE AQUI Y NO EN LAS RUTAS. Antes estaba escrita a mano
 * dentro de `app/api/usuarios/route.ts` y de `app/api/usuarios/[id]/route.ts`,
 * repetida en las dos y con cada regla comprobada de una forma distinta. Eso no
 * fue un problema de estilo: fue la causa de los agujeros. La regla de "no
 * tocar la cuenta de un administrador" solo se escribio en el PATCH, la de
 * "no repartir secciones que no tienes" se escribio en los dos sitios pero
 * dejando pasar `null`, y la de "al menos una seccion" solo se aplicaba cuando
 * la peticion traia el campo `rol`. Cada regla vivia dos veces y se olvidaba en
 * una.
 *
 * Aqui es una funcion PURA: recibe quien actua, sobre quien actua y que quiere
 * cambiar, y devuelve el motivo del rechazo o null. Sin base de datos, sin
 * sesion, sin peticion. Eso es lo que permite probar cada camino de ataque uno
 * por uno, que es como se encontraron estos fallos y como se evita que vuelvan.
 *
 * EL PRINCIPIO, EN UNA FRASE: un administrador puede todo; cualquier otro
 * —tipicamente un operador al que se le delego la seccion de Usuarios para que
 * administre cuentas del mostrador— solo puede actuar sobre cuentas que no
 * alcanzan mas lejos que la suya, y nunca puede repartir ni conservar acceso
 * que el mismo no tenga.
 */
import { seccionesDelRol } from '@/lib/permissions/rutas'
import type { RolUsuario, Usuario } from './types'

/** Quien esta haciendo el cambio. */
export interface Actor {
  id: string
  rol: RolUsuario
  /** `null` = las secciones propias de su rol. */
  secciones: string[] | null
}

/** Lo que la peticion quiere cambiar. Lo que no venga, no se toca. */
export interface CambioPedido {
  rol?: RolUsuario
  secciones?: string[] | null
  password?: string
  activo?: boolean
}

/**
 * Las secciones a las que ALCANZA una cuenta.
 *
 * `null` no es "ninguna": es "las de su rol". Confundir las dos cosas era el
 * agujero. El filtro de "no repartir lo que no tienes" hacia
 * `(secciones ?? [])`, asi que una peticion con `secciones: null` no tenia
 * nada que comparar y pasaba limpia —concediendo, de hecho, todas las
 * secciones del rol OPERADOR a una cuenta creada por alguien que no las
 * tenia—. Resolviendo el `null` a su significado real, ese caso se compara
 * como cualquier otro.
 */
export function alcanceDe(rol: RolUsuario, secciones: string[] | null | undefined): Set<string> {
  if (secciones && secciones.length > 0) return new Set(secciones)
  return new Set(seccionesDelRol(rol).map((seccion) => seccion.href))
}

/** Si `secciones` cabe entero dentro de lo que el actor ya tiene. */
function cabeEn(secciones: Set<string>, alcanceDelActor: Set<string>): boolean {
  for (const seccion of secciones) {
    if (!alcanceDelActor.has(seccion)) return false
  }
  return true
}

/** Un rechazo: el motivo que se le muestra al funcionario y el codigo HTTP. */
export interface Rechazo {
  motivo: string
  estado: 400 | 403
}

/**
 * Si el actor puede CREAR esa cuenta. Devuelve el rechazo, o null si puede.
 */
export function revisarAlta(actor: Actor, cambio: CambioPedido): Rechazo | null {
  const rol = cambio.rol ?? 'OPERADOR'

  const sinSecciones = revisarQueTengaDondeEntrar(rol, cambio.secciones)
  if (sinSecciones) return sinSecciones

  if (actor.rol === 'ADMINISTRADOR') return null

  if (rol === 'ADMINISTRADOR') {
    return { motivo: 'Solo un administrador puede crear otro administrador.', estado: 403 }
  }

  // La cuenta que nace no puede alcanzar mas lejos que la de quien la crea.
  // Se compara el ALCANCE, no la lista: `secciones: null` significa "las de su
  // rol", y por ahi se colaba una cuenta con acceso que el actor no tenia.
  if (!cabeEn(alcanceDe(rol, cambio.secciones), alcanceDe(actor.rol, actor.secciones))) {
    return { motivo: 'No puedes dar acceso a secciones que tu no tienes.', estado: 403 }
  }

  return null
}

/**
 * Si el actor puede CAMBIAR esa cuenta. Devuelve el rechazo, o null si puede.
 *
 * `objetivo` es la cuenta tal como esta AHORA, leida de la base. Hace falta
 * entera: varias reglas dependen de lo que la cuenta ya es —su rol, sus
 * secciones— y no solo de lo que la peticion quiere ponerle.
 */
export function revisarCambio(actor: Actor, objetivo: Usuario, cambio: CambioPedido): Rechazo | null {
  const esYo = objetivo.id === actor.id

  // Nadie se quita a si mismo el acceso: dejaria al sistema sin administrador
  // si es el unico que queda.
  if (esYo && (cambio.activo === false || cambio.rol === 'OPERADOR')) {
    return { motivo: 'No puedes quitarte a ti mismo el acceso de administrador.', estado: 400 }
  }

  const rolResultante = cambio.rol ?? objetivo.rol
  const seccionesResultantes = cambio.secciones !== undefined ? cambio.secciones : objetivo.secciones

  // Se valida contra el rol RESULTANTE y no contra el campo `rol` de la
  // peticion: antes la regla era `cambio.rol === 'OPERADOR' && ...`, asi que
  // un PATCH que mandara `secciones: []` sin mandar `rol` se la saltaba entera
  // y dejaba la cuenta en un estado que las dos implementaciones del
  // repositorio interpretaban al reves (una, sin ninguna pantalla; la otra,
  // con todas las de su rol).
  const sinSecciones = revisarQueTengaDondeEntrar(rolResultante, seccionesResultantes)
  if (sinSecciones) return sinSecciones

  if (actor.rol === 'ADMINISTRADOR') return null

  if (cambio.rol === 'ADMINISTRADOR') {
    return { motivo: 'Solo un administrador puede asignar el rol de administrador.', estado: 403 }
  }

  if (esYo && (cambio.secciones !== undefined || cambio.rol !== undefined)) {
    return { motivo: 'No puedes cambiar tu propio rol ni tus propios permisos.', estado: 403 }
  }

  // No se toca la cuenta de un administrador. Sin esto, un operador con la
  // seccion de usuarios le cambiaba la contraseña al administrador y entraba
  // como el. Se mira la cuenta REAL —incluidas las dadas de baja—, porque si
  // no, la misma jugada valia contra un administrador inactivo reactivandolo
  // en la misma peticion.
  if (objetivo.rol === 'ADMINISTRADOR') {
    return {
      motivo: 'Solo un administrador puede modificar la cuenta de otro administrador.',
      estado: 403,
    }
  }

  const alcanceDelActor = alcanceDe(actor.rol, actor.secciones)

  // LA CUENTA QUE SE TOCA NO PUEDE ALCANZAR MAS LEJOS QUE LA DEL ACTOR.
  //
  // Esta era la escalada de verdad, y faltaba entera. Las demas reglas miran
  // QUE se asigna; ninguna miraba SOBRE QUIEN se actua. Un operador cuyo unico
  // acceso era /admin/usuarios le cambiaba la contraseña a otro operador que
  // tuviera Citas, Servicios y Registro de actividad, y entraba con esa cuenta:
  // acababa dentro de la agenda y de la bitacora sin ser administrador, y los
  // apuntes quedaban a nombre del funcionario suplantado.
  //
  // Se mira el alcance ACTUAL del objetivo, no el resultante: lo que se roba al
  // cambiar la contraseña es lo que esa cuenta ya tiene.
  if (!esYo && !cabeEn(alcanceDe(objetivo.rol, objetivo.secciones), alcanceDelActor)) {
    return {
      motivo: 'No puedes modificar una cuenta con mas accesos que la tuya.',
      estado: 403,
    }
  }

  // Y tampoco se le puede dar al objetivo mas de lo que el actor tiene.
  if (
    cambio.secciones !== undefined &&
    !cabeEn(alcanceDe(rolResultante, cambio.secciones), alcanceDelActor)
  ) {
    return { motivo: 'No puedes dar acceso a secciones que tu no tienes.', estado: 403 }
  }

  return null
}

/**
 * Que la cuenta quede con alguna pantalla a la que entrar.
 *
 * Una lista VACIA no es "las de su rol": es "ninguna", y ese funcionario entra
 * y no tiene a donde ir. Para un administrador el campo se ignora, asi que no
 * se comprueba.
 */
function revisarQueTengaDondeEntrar(rol: RolUsuario, secciones: string[] | null | undefined) {
  if (rol === 'ADMINISTRADOR') return null
  if (secciones && secciones.length === 0) {
    return { motivo: 'Selecciona al menos una seccion para el operador.', estado: 400 as const }
  }
  return null
}

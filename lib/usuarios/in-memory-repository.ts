/**
 * TEMPORAL / DEV - implementacion en memoria de `UsuarioRepository`.
 *
 * El hospital AUN NO HA CONFIRMADO como se autentican sus funcionarios (ver
 * `lib/hospital/README.md`). Mientras tanto, el sistema arranca con dos cuentas
 * semilla (un administrador y un operador) para poder desarrollar y demostrar
 * las interfaces.
 *
 * Los usuarios viven solo en memoria del proceso (via `globalThis`, para
 * sobrevivir al HMR de desarrollo) y se pierden al reiniciar el servidor.
 * NO usar en produccion: cuando llegue la definicion del hospital se escribe
 * el adaptador real y la UI no cambia, porque ambos implementan el contrato.
 *
 * Las credenciales semilla se configuran por variables de entorno:
 *   TURNOS_ADMIN_USUARIO / TURNOS_ADMIN_PASSWORD
 *   TURNOS_OPERADOR_USUARIO / TURNOS_OPERADOR_PASSWORD
 */
import { cifrarContrasena, cifrarContrasenaAlSembrar, contrasenaCoincide, contrasenaCoincideSinDelatar } from './contrasenas'
import { errorDeNegocio } from '@/lib/turnos/errores'
import type { UsuarioRepository } from './repository'
import type { DatosUsuario, RolUsuario, Usuario } from './types'

interface RegistroUsuario extends Usuario {
  passwordHash: string
}

function crearId() {
  return Math.random().toString(36).slice(2, 10)
}

function normalizarUsuario(valor: string) {
  return valor.trim().toLowerCase()
}

function sinPassword(registro: RegistroUsuario): Usuario {
  const { passwordHash: _passwordHash, ...usuario } = registro
  return usuario
}

/**
 * Una lista VACIA se guarda como `null`.
 *
 * Es el mismo criterio que la implementacion contra Postgres, y tiene que
 * serlo: las dos cumplen el mismo contrato. Alli `[]` se traducia a `null` al
 * leer y aqui se conservaba, asi que la MISMA peticion dejaba al operador con
 * todas las secciones de su rol contra la base de verdad y sin ni una contra la
 * de memoria. Con dos comportamientos opuestos, ninguna prueba dice nada util
 * sobre lo que de verdad pasa en produccion.
 *
 * `null` significa "las de su rol". "Ninguna seccion" no es un estado valido, y
 * lo rechaza la politica de permisos antes de llegar hasta aqui.
 */
function normalizarSecciones(secciones: string[] | null | undefined): string[] | null {
  return secciones && secciones.length > 0 ? secciones : null
}

/**
 * Recibe el HASH ya calculado, no la contraseña.
 *
 * Asi este constructor sigue siendo sincrono —lo necesita el sembrado, que
 * corre al cargar el modulo— mientras que dar de alta una cuenta de verdad
 * cifra con la version asincrona, que no bloquea el servidor.
 */
function crearRegistro(params: {
  nombre: string
  usuario: string
  rol: RolUsuario
  area: string | null
  passwordHash: string
  secciones?: string[] | null
}): RegistroUsuario {
  return {
    id: crearId(),
    nombre: params.nombre,
    usuario: normalizarUsuario(params.usuario),
    rol: params.rol,
    area: params.area,
    activo: true,
    fechaCreacion: new Date().toISOString(),
    passwordHash: params.passwordHash,
    // Un administrador siempre ve todo, igual que en `actualizar`: el campo
    // solo aplica a OPERADOR. Sin esto se podia crear por API un administrador
    // con una lista recortada (o vacia), y ese usuario quedaba sin una sola
    // pantalla a la que entrar: el guarda lo devolvia al login y el login lo
    // mandaba de vuelta, en bucle.
    secciones: params.rol === 'ADMINISTRADOR' ? null : normalizarSecciones(params.secciones),
  }
}

function sembrar(): RegistroUsuario[] {
  return [
    crearRegistro({
      nombre: 'Administrador del sistema',
      usuario: process.env.TURNOS_ADMIN_USUARIO ?? 'admin',
      rol: 'ADMINISTRADOR',
      area: 'Sistemas',
      passwordHash: cifrarContrasenaAlSembrar(process.env.TURNOS_ADMIN_PASSWORD ?? 'admin1234'),
    }),
    crearRegistro({
      nombre: 'Operador de ventanilla',
      usuario: process.env.TURNOS_OPERADOR_USUARIO ?? 'operador',
      rol: 'OPERADOR',
      area: 'Facturacion',
      passwordHash: cifrarContrasenaAlSembrar(process.env.TURNOS_OPERADOR_PASSWORD ?? 'operador1234'),
    }),
  ]
}

declare global {
  var __turnosUsuarios: RegistroUsuario[] | undefined
}

const usuarios: RegistroUsuario[] = globalThis.__turnosUsuarios ?? sembrar()

// Se guarda SIEMPRE, tambien en produccion. Antes solo se hacia en desarrollo
// (para el HMR): fuera de ahi, cada contexto donde Next evaluaba este modulo
// arrancaba con los usuarios recien sembrados, asi que los permisos que el
// administrador le acababa de dar a un operador se perdian en silencio y el
// operador seguia viendo el menu de antes.
globalThis.__turnosUsuarios = usuarios

function buscarRegistro(id: string): RegistroUsuario {
  const registro = usuarios.find((u) => u.id === id)
  if (!registro) errorDeNegocio('El usuario indicado no existe.')
  return registro
}

export class InMemoryUsuarioRepository implements UsuarioRepository {
  async verificarCredenciales(usuario: string, password: string): Promise<Usuario | null> {
    const registro = usuarios.find((u) => u.usuario === normalizarUsuario(usuario))
    const vigente = registro?.activo ? registro : null
    if (!(await contrasenaCoincideSinDelatar(password, vigente?.passwordHash ?? null))) return null
    return vigente ? sinPassword(vigente) : null
  }

  async buscarPorId(id: string): Promise<Usuario | null> {
    const registro = usuarios.find((u) => u.id === id)
    return registro && registro.activo ? sinPassword(registro) : null
  }

  async listar(): Promise<Usuario[]> {
    return usuarios.map(sinPassword)
  }

  async crear(datos: DatosUsuario): Promise<Usuario> {
    if (!datos.password) errorDeNegocio('Debes definir una contrasena.')
    if (usuarios.some((u) => u.usuario === normalizarUsuario(datos.usuario))) {
      errorDeNegocio('Ya existe un usuario con ese nombre de usuario.')
    }

    const registro = crearRegistro({
      nombre: datos.nombre,
      usuario: datos.usuario,
      rol: datos.rol,
      area: datos.area ?? null,
      passwordHash: await cifrarContrasena(datos.password),
      secciones: datos.secciones,
    })
    usuarios.push(registro)
    return sinPassword(registro)
  }

  async actualizar(id: string, datos: Partial<DatosUsuario>): Promise<Usuario> {
    const registro = buscarRegistro(id)

    if (datos.usuario !== undefined) {
      const nuevoUsuario = normalizarUsuario(datos.usuario)
      if (usuarios.some((u) => u.id !== id && u.usuario === nuevoUsuario)) {
        errorDeNegocio('Ya existe un usuario con ese nombre de usuario.')
      }
      registro.usuario = nuevoUsuario
    }
    if (datos.nombre !== undefined) registro.nombre = datos.nombre
    if (datos.rol !== undefined) registro.rol = datos.rol
    if (datos.area !== undefined) registro.area = datos.area ?? null
    if (datos.activo !== undefined) registro.activo = datos.activo
    if (datos.password) {
      registro.passwordHash = await cifrarContrasena(datos.password)
      registro.versionCredenciales = (registro.versionCredenciales ?? 0) + 1
    }
    if (datos.secciones !== undefined) registro.secciones = normalizarSecciones(datos.secciones)
    // Un administrador siempre ve todo; el campo solo aplica a OPERADOR.
    if (registro.rol === 'ADMINISTRADOR') registro.secciones = null

    return sinPassword(registro)
  }

  async desactivar(id: string): Promise<Usuario> {
    const registro = buscarRegistro(id)
    registro.activo = false
    return sinPassword(registro)
  }
}

export const usuarioRepository: InMemoryUsuarioRepository = new InMemoryUsuarioRepository()

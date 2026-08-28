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
import bcrypt from 'bcryptjs'
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

function crearRegistro(params: {
  nombre: string
  usuario: string
  rol: RolUsuario
  area: string | null
  password: string
}): RegistroUsuario {
  return {
    id: crearId(),
    nombre: params.nombre,
    usuario: normalizarUsuario(params.usuario),
    rol: params.rol,
    area: params.area,
    activo: true,
    fechaCreacion: new Date().toISOString(),
    passwordHash: bcrypt.hashSync(params.password, 10),
  }
}

function sembrar(): RegistroUsuario[] {
  return [
    crearRegistro({
      nombre: 'Administrador del sistema',
      usuario: process.env.TURNOS_ADMIN_USUARIO ?? 'admin',
      rol: 'ADMINISTRADOR',
      area: 'Sistemas',
      password: process.env.TURNOS_ADMIN_PASSWORD ?? 'admin1234',
    }),
    crearRegistro({
      nombre: 'Operador de ventanilla',
      usuario: process.env.TURNOS_OPERADOR_USUARIO ?? 'operador',
      rol: 'OPERADOR',
      area: 'Facturacion',
      password: process.env.TURNOS_OPERADOR_PASSWORD ?? 'operador1234',
    }),
  ]
}

declare global {
  var __turnosUsuarios: RegistroUsuario[] | undefined
}

const usuarios: RegistroUsuario[] = globalThis.__turnosUsuarios ?? sembrar()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__turnosUsuarios = usuarios
}

function buscarRegistro(id: string): RegistroUsuario {
  const registro = usuarios.find((u) => u.id === id)
  if (!registro) errorDeNegocio('El usuario indicado no existe.')
  return registro
}

export class InMemoryUsuarioRepository implements UsuarioRepository {
  async verificarCredenciales(usuario: string, password: string): Promise<Usuario | null> {
    const registro = usuarios.find((u) => u.usuario === normalizarUsuario(usuario))
    if (!registro || !registro.activo) return null
    if (!bcrypt.compareSync(password, registro.passwordHash)) return null
    return sinPassword(registro)
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
      password: datos.password,
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
    if (datos.password) registro.passwordHash = bcrypt.hashSync(datos.password, 10)

    return sinPassword(registro)
  }

  async desactivar(id: string): Promise<Usuario> {
    const registro = buscarRegistro(id)
    registro.activo = false
    return sinPassword(registro)
  }
}

export const usuarioRepository: InMemoryUsuarioRepository = new InMemoryUsuarioRepository()

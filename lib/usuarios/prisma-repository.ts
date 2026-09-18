/**
 * Implementacion de `UsuarioRepository` contra PostgreSQL via Prisma.
 *
 * Mismo contrato y mismas reglas que la version en memoria; lo que cambia es
 * que las cuentas ya no se pierden al reiniciar el servidor. Eso importa mas de
 * lo que parece: en memoria, los permisos que el administrador le acababa de
 * dar a un operador desaparecian en el siguiente despliegue sin que nadie
 * viera un error, y el operador seguia con el menu de antes.
 *
 * LAS CUENTAS SEMILLA SIGUEN EXISTIENDO, pero ahora se siembran una sola vez
 * (ver `prisma/seed.ts`) en vez de recrearse en cada arranque. El hospital
 * todavia no ha confirmado como se autentican sus funcionarios
 * (`lib/hospital/README.md`); cuando lo haga se escribe el adaptador y la UI
 * no cambia, porque las tres implementaciones cumplen el mismo contrato.
 */
import { cifrarContrasena, contrasenaCoincide } from './contrasenas'
import { prisma } from '@/lib/prisma'
import { errorDeNegocio } from '@/lib/turnos/errores'
import type { UsuarioRepository } from './repository'
import type { DatosUsuario, Usuario } from './types'

type FilaUsuario = {
  id: string
  nombre: string
  usuario: string
  rol: 'ADMINISTRADOR' | 'OPERADOR'
  area: string | null
  activo: boolean
  secciones: string[]
  fechaCreacion: Date
}

/**
 * El nombre de entrada se guarda y se compara en minusculas: el mostrador
 * escribe el mismo usuario de varias maneras y todas tienen que entrar.
 */
function normalizarUsuario(valor: string) {
  return valor.trim().toLowerCase()
}

/**
 * `secciones` es una lista en la base y `string[] | null` en el dominio, donde
 * `null` significa "las de su rol". Una lista VACIA no puede representar eso:
 * seria "ninguna seccion", y ese usuario se quedaria sin una sola pantalla a la
 * que entrar. Por eso vacio se traduce a null.
 */
function aUsuario(fila: FilaUsuario): Usuario {
  return {
    id: fila.id,
    nombre: fila.nombre,
    usuario: fila.usuario,
    rol: fila.rol,
    area: fila.area,
    activo: fila.activo,
    fechaCreacion: fila.fechaCreacion.toISOString(),
    secciones: fila.secciones.length > 0 ? fila.secciones : null,
  }
}

const CAMPOS_PUBLICOS = {
  id: true,
  nombre: true,
  usuario: true,
  rol: true,
  area: true,
  activo: true,
  secciones: true,
  fechaCreacion: true,
} as const

export class PrismaUsuarioRepository implements UsuarioRepository {
  async verificarCredenciales(usuario: string, password: string): Promise<Usuario | null> {
    const registro = await prisma.usuario.findUnique({ where: { usuario: normalizarUsuario(usuario) } })
    if (!registro || !registro.activo) return null
    if (!(await contrasenaCoincide(password, registro.passwordHash))) return null
    return aUsuario(registro)
  }

  async buscarPorId(id: string): Promise<Usuario | null> {
    const registro = await prisma.usuario.findFirst({
      where: { id, activo: true },
      select: CAMPOS_PUBLICOS,
    })
    return registro ? aUsuario(registro) : null
  }

  async listar(): Promise<Usuario[]> {
    const registros = await prisma.usuario.findMany({
      select: CAMPOS_PUBLICOS,
      orderBy: { fechaCreacion: 'asc' },
    })
    return registros.map(aUsuario)
  }

  async crear(datos: DatosUsuario): Promise<Usuario> {
    if (!datos.password) errorDeNegocio('Debes definir una contrasena.')

    const usuario = normalizarUsuario(datos.usuario)
    if (!usuario) errorDeNegocio('Debes definir un nombre de usuario.')

    const repetido = await prisma.usuario.findUnique({ where: { usuario }, select: { id: true } })
    if (repetido) errorDeNegocio('Ya existe un usuario con ese nombre de usuario.')

    const registro = await prisma.usuario.create({
      data: {
        nombre: datos.nombre.trim(),
        usuario,
        rol: datos.rol,
        area: datos.area ?? null,
        activo: datos.activo ?? true,
        passwordHash: await cifrarContrasena(datos.password),
        // Un administrador siempre ve todo: el campo solo aplica a OPERADOR.
        // Sin esto se podia crear por API un administrador con una lista
        // recortada (o vacia), y ese usuario quedaba sin una sola pantalla a la
        // que entrar: el guarda lo devolvia al login y el login lo mandaba de
        // vuelta, en bucle.
        secciones: datos.rol === 'ADMINISTRADOR' ? [] : (datos.secciones ?? []),
      },
      select: CAMPOS_PUBLICOS,
    })
    return aUsuario(registro)
  }

  async actualizar(id: string, datos: Partial<DatosUsuario>): Promise<Usuario> {
    const actual = await prisma.usuario.findUnique({ where: { id }, select: { id: true, rol: true } })
    if (!actual) errorDeNegocio('El usuario indicado no existe.')

    const cambios: {
      nombre?: string
      usuario?: string
      rol?: 'ADMINISTRADOR' | 'OPERADOR'
      area?: string | null
      activo?: boolean
      passwordHash?: string
      secciones?: string[]
    } = {}

    if (datos.usuario !== undefined) {
      const usuario = normalizarUsuario(datos.usuario)
      const repetido = await prisma.usuario.findFirst({
        where: { usuario, id: { not: id } },
        select: { id: true },
      })
      if (repetido) errorDeNegocio('Ya existe un usuario con ese nombre de usuario.')
      cambios.usuario = usuario
    }
    if (datos.nombre !== undefined) cambios.nombre = datos.nombre.trim()
    if (datos.rol !== undefined) cambios.rol = datos.rol
    if (datos.area !== undefined) cambios.area = datos.area ?? null
    if (datos.activo !== undefined) cambios.activo = datos.activo
    if (datos.password) cambios.passwordHash = await cifrarContrasena(datos.password)
    if (datos.secciones !== undefined) cambios.secciones = datos.secciones ?? []

    // Un administrador siempre ve todo; el campo solo aplica a OPERADOR.
    if ((cambios.rol ?? actual.rol) === 'ADMINISTRADOR') cambios.secciones = []

    const registro = await prisma.usuario.update({
      where: { id },
      data: cambios,
      select: CAMPOS_PUBLICOS,
    })
    return aUsuario(registro)
  }

  /** Desactivar en lugar de borrar: el historico de turnos referencia al funcionario. */
  async desactivar(id: string): Promise<Usuario> {
    const existe = await prisma.usuario.findUnique({ where: { id }, select: { id: true } })
    if (!existe) errorDeNegocio('El usuario indicado no existe.')

    const registro = await prisma.usuario.update({
      where: { id },
      data: { activo: false },
      select: CAMPOS_PUBLICOS,
    })
    return aUsuario(registro)
  }
}

export const usuarioRepository: PrismaUsuarioRepository = new PrismaUsuarioRepository()

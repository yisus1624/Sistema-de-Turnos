'use client'

/**
 * Administracion de usuarios internos (requerimiento seccion 16).
 *
 * No se borran usuarios, se desactivan: el historico de turnos guarda quien
 * llamo cada uno y ese rastro no puede quedar huerfano.
 */

import { useCallback, useEffect, useState } from 'react'
import { Plus, UsersThree } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { Campo, Entrada, Interruptor, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import { secciones as catalogoSecciones, seccionesDelRol } from '@/lib/permissions/rutas'
import type { RolUsuario, Usuario } from '@/lib/usuarios/types'

type Formulario = {
  nombre: string
  usuario: string
  rol: RolUsuario
  area: string
  password: string
  /** `null` = acceso a todas las secciones de operador. */
  secciones: string[] | null
}

const FORMULARIO_VACIO: Formulario = {
  nombre: '',
  usuario: '',
  rol: 'OPERADOR',
  area: '',
  password: '',
  secciones: null,
}

/** Secciones marcables, agrupadas como en el menu. */
const gruposDePermisos = catalogoSecciones.reduce<Array<{ grupo: string; items: typeof catalogoSecciones }>>(
  (grupos, seccion) => {
    const existente = grupos.find((g) => g.grupo === seccion.grupo)
    if (existente) existente.items.push(seccion)
    else grupos.push({ grupo: seccion.grupo, items: [seccion] })
    return grupos
  },
  [],
)

const COLUMNAS = ['Nombre', 'Usuario', 'Rol', 'Area', 'Creado', 'Estado']

const etiquetaRol: Record<RolUsuario, string> = {
  ADMINISTRADOR: 'Administrador',
  OPERADOR: 'Operador',
}

function fechaCorta(iso: string) {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(
    new Date(iso),
  )
}

export default function UsuariosClient({ usuarioActualId }: { usuarioActualId: string }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const [editando, setEditando] = useState<Usuario | null>(null)
  const [formulario, setFormulario] = useState<Formulario>(FORMULARIO_VACIO)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const { usuarios: lista } = await pedir<{ usuarios: Usuario[] }>('/api/usuarios')
      setUsuarios(lista)
    } catch (error) {
      toast.error('No se pudieron cargar los usuarios', mensajeDeError(error))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  function abrirNuevo() {
    setEditando(null)
    setFormulario(FORMULARIO_VACIO)
    setAbierto(true)
  }

  function abrirEdicion(usuario: Usuario) {
    setEditando(usuario)
    setFormulario({
      nombre: usuario.nombre,
      usuario: usuario.usuario,
      rol: usuario.rol,
      area: usuario.area ?? '',
      password: '',
      secciones: usuario.secciones ?? null,
    })
    setAbierto(true)
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()

    if (formulario.rol === 'OPERADOR' && formulario.secciones && formulario.secciones.length === 0) {
      toast.error('Selecciona al menos una seccion', 'El operador necesita acceso a algo para poder trabajar.')
      return
    }

    setGuardando(true)

    try {
      const secciones = formulario.rol === 'OPERADOR' ? formulario.secciones : null

      if (editando) {
        const cuerpo: Record<string, unknown> = {
          nombre: formulario.nombre,
          usuario: formulario.usuario,
          rol: formulario.rol,
          area: formulario.area || null,
          secciones,
        }
        // La contrasena solo se envia si el administrador escribio una nueva.
        if (formulario.password) cuerpo.password = formulario.password

        await pedir(`/api/usuarios/${editando.id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) })
        toast.success('Usuario actualizado', formulario.nombre)
      } else {
        await pedir('/api/usuarios', {
          method: 'POST',
          body: JSON.stringify({ ...formulario, area: formulario.area || null, secciones }),
        })
        toast.success('Usuario creado', `${formulario.nombre} ya puede iniciar sesion.`)
      }
      setAbierto(false)
      await cargar()
    } catch (error) {
      toast.error('No se pudo guardar', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  async function cambiarEstado(usuario: Usuario, activo: boolean) {
    try {
      await pedir(`/api/usuarios/${usuario.id}`, { method: 'PATCH', body: JSON.stringify({ activo }) })
      setUsuarios((previos) => previos.map((u) => (u.id === usuario.id ? { ...u, activo } : u)))
      toast.info(activo ? 'Usuario activado' : 'Usuario desactivado', usuario.nombre)
    } catch (error) {
      toast.error('No se pudo cambiar el estado', mensajeDeError(error))
    }
  }

  return (
    <>
      <Card padded={false}>
        <CardHeader>
          <CardTitle>Funcionarios ({usuarios.length})</CardTitle>
          <Button size="sm" onClick={abrirNuevo}>
            <Plus size={17} weight="bold" />
            Nuevo usuario
          </Button>
        </CardHeader>
        <CardContent padded={false}>
          {cargando ? (
            <TablaSkeleton columnas={COLUMNAS} filas={4} />
          ) : usuarios.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={UsersThree} title="Sin usuarios" description="Crea las cuentas de los funcionarios." />
            </div>
          ) : (
            <Tabla columnas={COLUMNAS}>
              {usuarios.map((usuario) => {
                const esYo = usuario.id === usuarioActualId
                return (
                  <tr
                    key={usuario.id}
                    onClick={() => abrirEdicion(usuario)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-black text-brand-950">
                      {usuario.nombre}
                      {esYo ? <span className="ml-2 text-xs font-bold text-slate-400">(tu cuenta)</span> : null}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{usuario.usuario}</td>
                    <td className="px-4 py-3">
                      <Badge tone={usuario.rol === 'ADMINISTRADOR' ? 'blue' : 'slate'}>
                        {etiquetaRol[usuario.rol]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{usuario.area ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{fechaCorta(usuario.fechaCreacion)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-3">
                        <Interruptor
                          activo={usuario.activo}
                          onChange={(valor) => cambiarEstado(usuario, valor)}
                          etiqueta={`Activar ${usuario.nombre}`}
                          disabled={esYo}
                        />
                        <Badge tone={usuario.activo ? 'green' : 'slate'}>
                          {usuario.activo ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </Tabla>
          )}
        </CardContent>
      </Card>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={editando ? 'Editar usuario' : 'Nuevo usuario'}
        description="Los funcionarios entran con usuario y contrasena."
      >
        <form onSubmit={guardar} className="space-y-4">
          <Campo etiqueta="Nombre completo">
            <Entrada
              value={formulario.nombre}
              onChange={(e) => setFormulario((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Maria Fernanda Gomez"
              required
              minLength={3}
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Usuario">
              <Entrada
                value={formulario.usuario}
                onChange={(e) => setFormulario((f) => ({ ...f, usuario: e.target.value.toLowerCase() }))}
                placeholder="mgomez"
                autoCapitalize="none"
                required
                minLength={3}
              />
            </Campo>

            <Campo etiqueta="Rol">
              <Seleccion
                value={formulario.rol}
                onChange={(e) => setFormulario((f) => ({ ...f, rol: e.target.value as RolUsuario }))}
                disabled={editando?.id === usuarioActualId}
              >
                <option value="OPERADOR">Operador</option>
                <option value="ADMINISTRADOR">Administrador</option>
              </Seleccion>
            </Campo>
          </div>

          <Campo etiqueta="Area" ayuda="Opcional. Por ejemplo: Facturacion, SIAU, Sistemas.">
            <Entrada
              value={formulario.area}
              onChange={(e) => setFormulario((f) => ({ ...f, area: e.target.value }))}
              placeholder="Facturacion"
            />
          </Campo>

          {formulario.rol === 'OPERADOR' ? (
            <div className="rounded-xl border border-slate-200 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-slate-600">Secciones que puede usar</p>
                  <p className="mt-0.5 text-xs font-medium text-slate-400">
                    Deja el interruptor encendido para darle solo las secciones de operador, o apagalo para
                    elegir a mano, incluidas las de administracion.
                  </p>
                </div>
                <Interruptor
                  activo={formulario.secciones === null}
                  onChange={(valor) =>
                    setFormulario((f) => ({
                      ...f,
                      // Al pasar a manual, se parte de las secciones propias de
                      // su rol: quitarle todo de golpe seria un mal comienzo.
                      secciones: valor ? null : seccionesDelRol('OPERADOR').map((s) => s.href),
                    }))
                  }
                  etiqueta="Secciones de operador por defecto"
                />
              </div>

              {formulario.secciones === null ? (
                <p className="mt-3 text-sm font-semibold text-brand-700">
                  Acceso a todas las secciones de operador.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {gruposDePermisos.map(({ grupo, items }) => (
                    <div key={grupo}>
                      <p className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-slate-400">
                        {grupo}
                        {items[0].rol === 'ADMINISTRADOR' ? ' · administracion' : ''}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {items.map((item) => {
                          const marcado = formulario.secciones?.includes(item.href) ?? false
                          return (
                            <label
                              key={item.href}
                              className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                            >
                              <input
                                type="checkbox"
                                checked={marcado}
                                onChange={(e) =>
                                  setFormulario((f) => {
                                    const actuales = f.secciones ?? []
                                    const siguientes = e.target.checked
                                      ? [...actuales, item.href]
                                      : actuales.filter((href) => href !== item.href)
                                    return { ...f, secciones: siguientes }
                                  })
                                }
                                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                              />
                              {item.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <Campo
            etiqueta={editando ? 'Nueva contrasena' : 'Contrasena'}
            ayuda={editando ? 'Dejala vacia para no cambiarla.' : 'Minimo 8 caracteres.'}
          >
            <Entrada
              type="password"
              value={formulario.password}
              onChange={(e) => setFormulario((f) => ({ ...f, password: e.target.value }))}
              autoComplete="new-password"
              required={!editando}
              minLength={editando && !formulario.password ? undefined : 8}
            />
          </Campo>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={guardando}>
              {editando ? 'Guardar cambios' : 'Crear usuario'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

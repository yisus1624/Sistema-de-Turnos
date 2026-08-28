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
import { Campo, Entrada, Interruptor, Seleccion, Tabla } from '@/components/admin/Campos'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import type { RolUsuario, Usuario } from '@/lib/usuarios/types'

type Formulario = {
  nombre: string
  usuario: string
  rol: RolUsuario
  area: string
  password: string
}

const FORMULARIO_VACIO: Formulario = { nombre: '', usuario: '', rol: 'OPERADOR', area: '', password: '' }

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
    })
    setAbierto(true)
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    setGuardando(true)

    try {
      if (editando) {
        const cuerpo: Record<string, unknown> = {
          nombre: formulario.nombre,
          usuario: formulario.usuario,
          rol: formulario.rol,
          area: formulario.area || null,
        }
        // La contrasena solo se envia si el administrador escribio una nueva.
        if (formulario.password) cuerpo.password = formulario.password

        await pedir(`/api/usuarios/${editando.id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) })
        toast.success('Usuario actualizado', formulario.nombre)
      } else {
        await pedir('/api/usuarios', {
          method: 'POST',
          body: JSON.stringify({ ...formulario, area: formulario.area || null }),
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
            <p className="px-5 py-10 text-center text-sm text-slate-500">Cargando usuarios...</p>
          ) : usuarios.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={UsersThree} title="Sin usuarios" description="Crea las cuentas de los funcionarios." />
            </div>
          ) : (
            <Tabla columnas={['Nombre', 'Usuario', 'Rol', 'Area', 'Creado', 'Estado', '']}>
              {usuarios.map((usuario) => {
                const esYo = usuario.id === usuarioActualId
                return (
                  <tr key={usuario.id} className="hover:bg-slate-50">
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
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => abrirEdicion(usuario)}>
                        Editar
                      </Button>
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

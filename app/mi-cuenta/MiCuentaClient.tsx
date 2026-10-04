'use client'

/**
 * La pantalla donde el ADMINISTRADOR cambia SU usuario y SU contrasena.
 *
 * No administra cuentas: no lista, no crea y no toca la de nadie mas. Para eso
 * esta `/admin/usuarios`, donde el administrador tambien cambia el usuario y
 * la clave de los operadores (ellos no tienen esta pantalla).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Key, UserCircle } from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Campo, Entrada } from '@/components/admin/Campos'
import { toast } from '@/components/ui/toast'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
// El nombre legible del rol sale del mismo sitio que el del menu; `navigation`
// arrastra iconos y solo se puede evaluar en el navegador, asi que se lee aqui
// y no en la pagina (que corre en el servidor).
import { rolLabels } from '@/components/layout/navigation'
import type { RolUsuario } from '@/lib/usuarios/types'

/** El mismo minimo que pide la administracion de usuarios. */
const MINIMO_CARACTERES = 8

const CLAVE_VACIA = { actual: '', nueva: '', repetida: '' }

export default function MiCuentaClient({ usuario, rol }: { usuario: string; rol: RolUsuario }) {
  const router = useRouter()
  const [usuarioActual, setUsuarioActual] = useState(usuario)

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <CambiarUsuario
        usuarioActual={usuarioActual}
        alCambiar={(nuevo) => {
          setUsuarioActual(nuevo)
          // El menu y la cabecera leen el usuario de la sesion: que se repinten.
          router.refresh()
        }}
      />
      <CambiarContrasena />

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Tu cuenta</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Usuario</dt>
              <dd className="mt-0.5 font-semibold text-brand-950">{usuarioActual}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Rol</dt>
              <dd className="mt-0.5 font-semibold text-brand-950">{rolLabels[rol]}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm leading-[1.65] text-slate-600">
            Tu cuenta es siempre la misma aunque cambies de usuario: el sistema no la reemplaza, la edita, para no
            perder el rastro de lo que ya hiciste. El usuario y la contrasena de los operadores los cambias desde
            Usuarios.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function CambiarUsuario({ usuarioActual, alCambiar }: { usuarioActual: string; alCambiar: (nuevo: string) => void }) {
  const [nuevo, setNuevo] = useState('')
  const [actual, setActual] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    try {
      const { usuario } = await pedir<{ usuario: string }>('/api/cuenta/contrasena', {
        method: 'POST',
        body: JSON.stringify({ actual, usuario: nuevo }),
      })
      setNuevo('')
      setActual('')
      alCambiar(usuario)
      toast.success('Usuario actualizado', `Desde ahora entras con "${usuario}".`)
    } catch (error) {
      toast.error('No se pudo cambiar el usuario', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cambiar mi usuario</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={guardar} className="space-y-4">
          <Campo etiqueta="Usuario nuevo" ayuda={`Ahora entras con "${usuarioActual}". Letras, numeros, punto o guion.`}>
            <Entrada
              value={nuevo}
              onChange={(e) => setNuevo(e.target.value.toLowerCase())}
              autoCapitalize="none"
              autoComplete="username"
              required
              minLength={3}
              maxLength={40}
            />
          </Campo>
          <Campo etiqueta="Contrasena actual" ayuda="Se pide para confirmar que eres tu.">
            <Entrada
              type="password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Campo>
          <div className="flex justify-end pt-1">
            <Button type="submit" loading={guardando}>
              <UserCircle size={17} weight="bold" />
              Cambiar usuario
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function CambiarContrasena() {
  const [formulario, setFormulario] = useState(CLAVE_VACIA)
  const [guardando, setGuardando] = useState(false)

  function escribir(campo: keyof typeof CLAVE_VACIA, valor: string) {
    setFormulario((actual) => ({ ...actual, [campo]: valor }))
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()

    // La repeticion se comprueba aqui y no en el servidor: es una errata al
    // teclear, no una regla del sistema, y avisarla sin ir y volver evita
    // gastar uno de los intentos permitidos.
    if (formulario.nueva !== formulario.repetida) {
      toast.error('Las contrasenas no coinciden', 'Escribe la misma contrasena nueva en los dos campos.')
      return
    }

    setGuardando(true)
    try {
      await pedir('/api/cuenta/contrasena', {
        method: 'POST',
        body: JSON.stringify({ actual: formulario.actual, nueva: formulario.nueva }),
      })
      setFormulario(CLAVE_VACIA)
      toast.success('Contrasena actualizada', 'Usala la proxima vez que inicies sesion.')
    } catch (error) {
      toast.error('No se pudo cambiar la contrasena', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cambiar mi contrasena</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={guardar} className="space-y-4">
          <Campo etiqueta="Contrasena actual" ayuda="Se pide para confirmar que eres tu.">
            <Entrada
              type="password"
              value={formulario.actual}
              onChange={(e) => escribir('actual', e.target.value)}
              autoComplete="current-password"
              required
            />
          </Campo>

          <Campo etiqueta="Contrasena nueva" ayuda={`Minimo ${MINIMO_CARACTERES} caracteres.`}>
            <Entrada
              type="password"
              value={formulario.nueva}
              onChange={(e) => escribir('nueva', e.target.value)}
              autoComplete="new-password"
              required
              minLength={MINIMO_CARACTERES}
            />
          </Campo>

          <Campo etiqueta="Repite la contrasena nueva">
            <Entrada
              type="password"
              value={formulario.repetida}
              onChange={(e) => escribir('repetida', e.target.value)}
              autoComplete="new-password"
              required
              minLength={MINIMO_CARACTERES}
            />
          </Campo>

          <div className="flex justify-end pt-1">
            <Button type="submit" loading={guardando}>
              <Key size={17} weight="bold" />
              Cambiar contrasena
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

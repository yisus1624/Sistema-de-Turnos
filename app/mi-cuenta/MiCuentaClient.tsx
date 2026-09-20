'use client'

/**
 * La pantalla donde cada funcionario cambia SU contrasena.
 *
 * No administra cuentas: no lista, no crea y no toca la de nadie mas. Para eso
 * esta `/admin/usuarios`, que pide la seccion correspondiente.
 */

import { useState } from 'react'
import { Key } from '@phosphor-icons/react'
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

const FORMULARIO_VACIO = { actual: '', nueva: '', repetida: '' }

export default function MiCuentaClient({ usuario, rol }: { usuario: string; rol: RolUsuario }) {
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO)
  const [guardando, setGuardando] = useState(false)

  function escribir(campo: keyof typeof FORMULARIO_VACIO, valor: string) {
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
      setFormulario(FORMULARIO_VACIO)
      toast.success('Contrasena actualizada', 'Usala la proxima vez que inicies sesion.')
    } catch (error) {
      toast.error('No se pudo cambiar la contrasena', mensajeDeError(error))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
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

      <Card>
        <CardHeader>
          <CardTitle>Tu cuenta</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Usuario</dt>
              <dd className="mt-0.5 font-semibold text-brand-950">{usuario}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Rol</dt>
              <dd className="mt-0.5 font-semibold text-brand-950">{rolLabels[rol]}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm leading-[1.65] text-slate-600">
            El nombre de usuario y el rol los cambia un administrador desde Usuarios. Tu cuenta es siempre la
            misma aunque cambie de nombre: el sistema no la reemplaza, la edita, para no perder el rastro de
            los turnos que ya llamaste.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

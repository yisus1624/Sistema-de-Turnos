import { redirect } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import { auth } from '@/lib/auth'
import MiCuentaClient from './MiCuentaClient'

export const metadata = { title: 'Mi cuenta' }

/**
 * NO PASA POR `RoleShell` NI POR EL CATALOGO DE SECCIONES, y es deliberado.
 *
 * Una "seccion" es algo que un administrador reparte: se puede dar o quitar.
 * Cambiar la propia contrasena no se le puede quitar a nadie —un operador al
 * que le recortaron el menu tiene que poder hacerlo igual—, asi que no es una
 * seccion y no entra en `lib/permissions/rutas.ts`. El unico requisito es
 * tener sesion, que es lo que se comprueba aqui; el servidor lo vuelve a
 * comprobar en la ruta, que es donde de verdad protege.
 */
export default async function MiCuentaPage() {
  const session = await auth()
  if (!session?.user) redirect('/auth/login')

  return (
    <AppShell
      rol={session.user.rol}
      nombreUsuario={session.user.name}
      area={session.user.area}
      secciones={session.user.secciones}
      title="Mi cuenta"
      description="Cambia tu contrasena. Se te pide la actual para confirmar que eres tu."
    >
      <MiCuentaClient usuario={session.user.usuario} rol={session.user.rol} />
    </AppShell>
  )
}

import { redirect } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import { auth } from '@/lib/auth'
import { primeraRutaPermitida, tieneMiCuenta } from '@/lib/permissions/rutas'
import { turnoRepository } from '@/lib/turnos/repositorio'
import MiCuentaClient from './MiCuentaClient'

export const metadata = { title: 'Mi cuenta' }

/**
 * SOLO EL ADMINISTRADOR (decision del hospital): aqui cambia su usuario y su
 * contrasena. A un operador, o a la cuenta de demostracion, se le devuelve a
 * su pantalla de entrada; sus cuentas las maneja el administrador en Usuarios.
 * El servidor lo vuelve a comprobar en la ruta, que es donde de verdad protege.
 *
 * No pasa por `RoleShell` porque no es una seccion que se reparta.
 */
export default async function MiCuentaPage() {
  const session = await auth()
  if (!session?.user) redirect('/auth/login')
  if (!tieneMiCuenta(session.user.rol, session.user.demostracion)) {
    redirect(primeraRutaPermitida(session.user.rol, session.user.secciones))
  }

  return (
    <AppShell
      rol={session.user.rol}
      nombreUsuario={session.user.name}
      area={session.user.area}
      secciones={session.user.secciones}
      demostracion={session.user.demostracion}
      modoAcceso={await turnoRepository.configuracion().then((c) => c.accesoProfesionales).catch(() => undefined)}
      title="Mi cuenta"
      description="Cambia tu usuario o tu contrasena. Se te pide la contrasena actual para confirmar que eres tu."
    >
      <MiCuentaClient usuario={session.user.usuario} rol={session.user.rol} />
    </AppShell>
  )
}

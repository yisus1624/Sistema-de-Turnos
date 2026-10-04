import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { primeraRutaPermitida, puedeVerSeccion, seccionDelModo } from '@/lib/permissions/rutas'
import { turnoRepository } from '@/lib/turnos/repositorio'
import type { RolUsuario } from '@/lib/usuarios/types'
import AppShell from './AppShell'

type RoleShellProps = {
  /** Rol al que pertenece la pantalla. Solo se usa si no se indica `seccion`. */
  rol: RolUsuario
  /**
   * Href de esta pantalla en el menu. Es lo que decide el acceso: un operador
   * al que le dieron esta seccion entra aunque la pantalla sea de
   * administracion (ver `lib/permissions/rutas.ts`).
   */
  seccion?: string
  title: string
  description: string
  children: React.ReactNode
}

/** Envoltura de las pantallas internas: verifica sesion y permisos (seccion 17). */
export default async function RoleShell({ rol, seccion, title, description, children }: RoleShellProps) {
  const session = await auth()

  if (!session?.user) redirect('/auth/login')

  const { rol: rolUsuario, secciones, demostracion } = session.user

  // El modo de entrada de los medicos oculta Enlaces o PIN (ver `soloConAcceso`).
  // Si no se pudiera leer, se muestran las dos: mejor que dejar al
  // administrador sin la pantalla que necesita.
  const modoAcceso = await turnoRepository
    .configuracion()
    .then((configuracion) => configuracion.accesoProfesionales)
    .catch(() => undefined)

  const permitido =
    (seccion ? puedeVerSeccion(rolUsuario, secciones, seccion, demostracion) : rolUsuario === rol) &&
    (!seccion || seccionDelModo(seccion, modoAcceso))
  if (!permitido) redirect(primeraRutaPermitida(rolUsuario, secciones))

  return (
    <AppShell
      rol={rolUsuario}
      title={title}
      description={description}
      nombreUsuario={session.user.name}
      area={session.user.area}
      secciones={secciones}
      demostracion={demostracion}
      modoAcceso={modoAcceso}
    >
      {children}
    </AppShell>
  )
}

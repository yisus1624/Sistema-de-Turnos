import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { rutaInicialPorRol } from '@/lib/auth-routing'

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const destino = rutaInicialPorRol(session?.user?.rol, session?.user?.secciones)

  if (destino !== '/auth/login') {
    redirect(destino)
  }

  return children
}

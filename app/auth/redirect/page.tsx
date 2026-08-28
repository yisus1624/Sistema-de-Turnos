import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { rutaInicialPorRol } from '@/lib/auth-routing'

export default async function AuthRedirectPage() {
  const session = await auth()
  redirect(rutaInicialPorRol(session?.user?.rol))
}

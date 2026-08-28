import { redirect } from 'next/navigation'

/**
 * La raiz envia a la pantalla que corresponda: si hay sesion abierta, al panel
 * del rol; si no, al inicio de sesion. La pantalla publica del televisor vive
 * en `/pantalla` y no pasa por aqui.
 */
export default function HomePage() {
  redirect('/auth/redirect')
}

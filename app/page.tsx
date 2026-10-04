import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { COOKIE_ENTRADA, ENTRADA_DE_MEDICO } from '@/lib/consultorio/freno-pin'

/**
 * La entrada de la app instalada (`start_url` del manifiesto).
 *
 * Con sesion, cada quien a su pantalla. Sin sesion, en un navegador donde ya
 * entro un medico con su PIN, directo al PIN: en el computador del consultorio
 * el medico toca el icono y escribe su PIN, sin pasar por el inicio de sesion
 * de los funcionarios. Si no, al login (que tiene el boton para los medicos).
 */
export default async function HomePage() {
  const session = await auth()
  if (!session?.user && (await cookies()).get(COOKIE_ENTRADA)?.value === ENTRADA_DE_MEDICO) redirect('/medico')
  redirect('/auth/redirect')
}

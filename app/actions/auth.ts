'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { signOut } from '@/lib/auth'
import { isAuthSessionCookie, isSecureCookieName } from '@/lib/auth-cookies'

export async function logoutAction() {
  await signOut({ redirect: false })

  const cookieStore = await cookies()
  for (const cookie of cookieStore.getAll()) {
    if (!isAuthSessionCookie(cookie.name)) continue

    // `delete(name)` does not include Secure. Browsers reject that deletion for
    // __Secure- cookies, leaving a production JWT alive after the redirect.
    cookieStore.set(cookie.name, '', {
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: isSecureCookieName(cookie.name),
    })
  }

  redirect('/auth/login')
}

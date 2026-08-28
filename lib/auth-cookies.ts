/**
 * Keep Auth.js and the route proxy on one deterministic cookie policy.
 *
 * Production is HTTPS-only, even when a reverse proxy forwards the request to
 * Next.js over HTTP. Deriving this from request headers can otherwise create
 * both secure and non-secure session cookies for the same browser.
 */
export const useSecureAuthCookies = process.env.NODE_ENV === 'production'

export const authSessionCookieName = `${useSecureAuthCookies ? '__Secure-' : ''}authjs.session-token`

const sessionCookieBases = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
] as const

export function isAuthSessionCookie(name: string) {
  return sessionCookieBases.some((base) => name === base || name.startsWith(`${base}.`))
}

export function isSecureCookieName(name: string) {
  return name.startsWith('__Secure-') || name.startsWith('__Host-')
}

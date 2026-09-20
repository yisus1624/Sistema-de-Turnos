import ConsultorioClient from './ConsultorioClient'

/*
  Enlace personal del profesional: nunca debe indexarse ni compartirse por
  buscadores.

  LA PAGINA YA NO LLEVA EL TOKEN EN SU DIRECCION. Se entra por
  `/consultorio/<token>`, `proxy.ts` lo canjea por una cookie `HttpOnly` y
  redirige aqui (ver `proxy.ts`). Desde este punto ni la barra de
  direcciones, ni el `Referer`, ni el registro de peticiones del servidor
  vuelven a ver el token.
*/
export const metadata = { robots: { index: false, follow: false } }

export default function Pagina() {
  return <ConsultorioClient />
}

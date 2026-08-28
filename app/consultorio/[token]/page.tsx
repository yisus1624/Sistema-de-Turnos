import ConsultorioClient from './ConsultorioClient'

// Enlace personal del profesional: nunca debe indexarse ni compartirse por buscadores.
export const metadata = { robots: { index: false, follow: false } }

export default async function Pagina({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ConsultorioClient token={token} />
}

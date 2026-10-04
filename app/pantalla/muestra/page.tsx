/**
 * Muestra de la pantalla del televisor con datos SIMULADOS, solo en desarrollo.
 *
 * Sirve para comprobar que el reparto se ajusta a cualquier televisor (varias
 * resoluciones, 1 a 20 consultorios) sin escribir nada en la base: los datos
 * se inventan en el navegador. En produccion no existe (404).
 *
 * Uso: /pantalla/muestra?n=12&diseno=paciente&medico=largo&resaltar=1
 * (`diseno=paciente` es la cartelera con el nombre del paciente).
 */
import { notFound } from 'next/navigation'
import MuestraCliente from './MuestraCliente'

export default async function MuestraDePantalla({
  searchParams,
}: {
  searchParams: Promise<{ n?: string; diseno?: string; medico?: string; resaltar?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { n, diseno, medico, resaltar } = await searchParams
  const cantidad = Math.min(40, Math.max(0, Number.parseInt(n ?? '12', 10) || 0))
  return (
    <MuestraCliente
      cantidad={cantidad}
      variante={diseno === 'paciente' ? 'paciente' : 'turno'}
      nombresLargos={medico === 'largo'}
      resaltar={resaltar === '1'}
    />
  )
}

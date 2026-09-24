import { WarningCircle } from '@phosphor-icons/react/dist/ssr'

/**
 * Lo que se ve cuando una pantalla se rompio al dibujarse (los `error.tsx` de
 * `app/`).
 *
 * Ocupa la pantalla entera porque el error se lleva tambien la barra lateral:
 * el menu se monta dentro de cada pagina, no en un layout aparte. Sigue el
 * mismo aspecto que los avisos a pantalla completa del consultorio (enlace
 * vencido, sin conexion) para que se lea como parte del sistema y no como un
 * fallo del navegador.
 */
export default function PantallaDeError({
  titulo,
  descripcion,
  children,
}: {
  titulo: string
  descripcion: string
  /** Las salidas: reintentar, volver al inicio. */
  children?: React.ReactNode
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--turnos-bg)] px-6 text-center">
      <div className="max-w-md space-y-4">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-600">
          <WarningCircle size={32} weight="fill" />
        </div>
        <div role="alert" className="space-y-2">
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-brand-950">{titulo}</h1>
          <p className="text-sm leading-6 text-slate-600">{descripcion}</p>
        </div>
        {children ? <div className="flex flex-col items-center gap-3 pt-2">{children}</div> : null}
      </div>
    </main>
  )
}

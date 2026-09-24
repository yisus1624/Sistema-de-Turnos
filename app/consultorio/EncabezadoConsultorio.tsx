'use client'

/**
 * La barra de arriba de la pantalla del doctor: el hospital, quien atiende y
 * DONDE. Es una capa translucida que se queda fija y deja pasar el contenido
 * por debajo al desplazarse.
 *
 * El consultorio se MUESTRA, no se elige: es el que el doctor trae asignado en
 * la agenda que carga el hospital (ver `app/api/consultorio/route.ts`).
 */
import { MapPin } from '@phosphor-icons/react/dist/ssr'
import { IndicadorConexion } from '@/components/ui/IndicadorConexion'
import { Isotipo, NOMBRE_INSTITUCION } from '@/components/brand/Marca'
import type { EstadoConexionEnVivo } from '@/lib/hooks'
import { iniciales } from '@/lib/consultorio/presentacion'

export function EncabezadoConsultorio({
  doctor,
  especialidad,
  consultorio,
  conexion,
}: {
  doctor: string
  especialidad: string | null
  consultorio: string | null
  conexion: EstadoConexionEnVivo
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/70 bg-white/75 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Isotipo size={42} />
          <div className="min-w-0 leading-tight">
            <p className="text-[15px] font-semibold tracking-[-0.015em] text-brand-950">Mi consultorio</p>
            <p className="truncate text-xs font-medium text-slate-500">{NOMBRE_INSTITUCION}</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5">
          <IndicadorConexion estado={conexion} />

          <span
            className="inline-flex h-10 max-w-[18rem] items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3.5 text-sm font-semibold text-brand-950"
            title="Tu consultorio asignado en la agenda del hospital"
          >
            <MapPin size={17} weight="fill" className="shrink-0 text-acento-600" />
            <span className="truncate">{consultorio ?? 'Sin consultorio asignado'}</span>
          </span>

          <span className="inline-flex h-10 items-center gap-2.5 rounded-full border border-slate-200/80 bg-white py-1 pl-1 pr-4">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-acento-500 to-brand-600 text-xs font-semibold text-white"
            >
              {iniciales(doctor)}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block max-w-[14rem] truncate text-sm font-semibold text-brand-950">{doctor}</span>
              {especialidad ? (
                <span className="block max-w-[14rem] truncate text-[11px] font-medium text-slate-500">{especialidad}</span>
              ) : null}
            </span>
          </span>
        </div>
      </div>
    </header>
  )
}

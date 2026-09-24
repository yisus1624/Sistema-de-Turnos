'use client'

/**
 * Limite de errores del televisor de la sala de espera.
 *
 * ES EL QUE MAS IMPORTA: delante del televisor no hay nadie que sepa recargar.
 * Sin el, una excepcion al pintar dejaba la pantalla en blanco y la sala sin
 * turnos hasta que alguien de sistemas pasara por ahi. Ahora:
 *
 *   1. Vuelve a pintar la pantalla solo, con espera creciente (el primer
 *      intento a los ~2 s). Casi siempre basta.
 *   2. Si a los ~30 s del primer fallo sigue rota, recarga la pagina entera,
 *      pero solo cuando el servidor contesta: con el servidor caido, recargar
 *      dejaria la pagina de error del navegador, que no vuelve sola (ver
 *      `lib/api/recuperacion.ts`).
 *
 * Lo que se lee mientras tanto es para la sala: letra grande que escala con
 * el televisor, alto contraste, sin terminos tecnicos y sin boton, porque no
 * hay a quien pedirselo. Sin animaciones: nada que respetar en
 * `prefers-reduced-motion`.
 */
import { useEffect } from 'react'
import type { ErrorInfo } from 'next/error'
import { Isotipo, NOMBRE_INSTITUCION } from '@/components/brand/Marca'
import { crearRachaDeFallos, programarRecuperacion, recargaDelNavegador } from '@/lib/api/recuperacion'

/** Cuanto tiempo rota, desde el primer fallo, antes de recargar la pagina entera. */
const MS_HASTA_RECARGAR = 30_000

// Fuera del componente: React vuelve a montar este aviso con cada reintento
// que falla, y la racha tiene que seguir contando (ver `RachaDeFallos`).
const racha = crearRachaDeFallos()

export default function ErrorDelTelevisor({ reset }: ErrorInfo) {
  useEffect(
    () => programarRecuperacion({ racha, reintentar: reset, recarga: recargaDelNavegador(MS_HASTA_RECARGAR) }),
    [reset],
  )

  return (
    <main data-pantalla-tv className="grid h-screen place-items-center bg-[var(--turnos-bg)] px-[6vmin] text-center">
      <div className="max-w-[80vw] space-y-[3vmin]">
        <Isotipo size="12vmin" />
        <h1 role="status" className="text-[6vmin] font-black leading-tight tracking-[-0.02em] text-brand-950">
          Un momento, por favor
        </h1>
        <p className="text-[3.2vmin] font-semibold leading-snug text-slate-700">
          La pantalla de turnos se está actualizando y vuelve sola en unos segundos.
        </p>
        <p className="text-[2.2vmin] font-bold uppercase tracking-[0.12em] text-slate-500">{NOMBRE_INSTITUCION}</p>
      </div>
    </main>
  )
}

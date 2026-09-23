'use client'

/**
 * Lo que rodea a la tabla de la CARTELERA: la fotografia de fondo, la cabecera
 * con la marca y los mandos, y la banda de avisos al pie. Es la pieza que
 * aprobo el hospital; aqui no se decide nada de turnos.
 *
 * Todo se mide en `rem`, que en el televisor escala con la pantalla (ver
 * `html:has([data-pantalla-tv])` en globals.css): en un 4K la cabecera y el
 * pie crecen igual que los turnos, en vez de quedarse como sellos.
 */
import type { ReactNode } from 'react'
import { Clock, HandHeart, Heartbeat, UsersThree } from '@phosphor-icons/react/dist/ssr'
import { Isotipo } from '@/components/brand/Marca'
import { cn } from '@/lib/ui'
import { AZUL_CLARO, AZUL_MEDIO, AZUL_PROFUNDO } from './colores-cartelera'

/**
 * La fotografia a la izquierda, fundida con el blanco antes del centro, como en
 * la pieza aprobada: la tabla se apoya sobre fondo limpio y la foto no le
 * compite. La mascara es de OPACIDAD, no de color: no tiñe la foto.
 */
export function FotoCartelera({ ruta }: { ruta: string }) {
  if (!ruta) return null
  const mascara = 'linear-gradient(to right, black 55%, transparent 100%)'
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-y-0 left-0 w-[58%]" style={{ maskImage: mascara, WebkitMaskImage: mascara }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ruta configurable por el administrador */}
        <img src={ruta} alt="" className="h-full w-full object-cover object-left" />
      </div>
      {/* Velo muy corto: la foto tiene que reconocerse, no mandar. */}
      <div className="absolute inset-0 bg-white/25" />
    </div>
  )
}

/**
 * La cabecera. Lo decorativo se esconde en pantallas angostas o verticales;
 * la hora y los mandos NUNCA: son lo que se toca, y el aviso de sonido no
 * puede quedar fuera de la pantalla.
 */
export function CabeceraCartelera({ servicio, hora, controles }: { servicio: string; hora: string | null; controles: ReactNode }) {
  return (
    <header className="relative z-10 flex shrink-0 items-center justify-between gap-6 px-[2.5vmin] py-[1.4vmin]">
      <div className="flex min-w-0 items-center gap-5">
        <Isotipo size="4.75rem" />
        <div className="min-w-0">
          <p className="text-[clamp(0.9rem,1.9vmin,1.4rem)] font-medium leading-tight text-slate-700">ESE Hospital</p>
          <p className="truncate text-[clamp(1.4rem,3.2vmin,2.4rem)] font-bold leading-tight tracking-[-0.02em]" style={{ color: AZUL_PROFUNDO }}>
            San Rafael de Chinu
          </p>
          <p className="truncate text-[clamp(0.7rem,1.4vmin,1rem)] font-medium leading-tight text-slate-600">Tu salud, nuestra prioridad</p>
        </div>
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-5 xl:gap-7">
        <RotuloDeServicio servicio={servicio} />
        <Lema />
        {/*
          La hora y los mandos no estaban en la pieza aprobada —era una imagen
          fija—, pero el televisor de verdad los necesita. Van al final y en
          discreto, para no alterar la composicion.
        */}
        <div className="flex items-center gap-4 border-l border-slate-900/10 pl-6">
          {hora ? (
            <p data-cifras className="text-[clamp(1rem,2.1vmin,1.5rem)] font-semibold text-slate-700">
              {hora}
            </p>
          ) : null}
          {controles}
        </div>
      </div>
    </header>
  )
}

/**
 * El rotulo grande de la derecha: el servicio del turno que se esta llamando,
 * no un texto escrito a mano, porque el mismo televisor sirve para consulta
 * externa, odontologia o las ventanillas. Solo en horizontal y desde 1280 px:
 * en un televisor vertical o en uno 4:3 no cabe junto a la marca, y la marca
 * se cortaba.
 */
function RotuloDeServicio({ servicio }: { servicio: string }) {
  return (
    <div className="hidden text-right landscape:xl:block">
      <p className="text-[clamp(0.9rem,1.9vmin,1.4rem)] font-medium leading-tight text-slate-700">Turnos de Atencion</p>
      {servicio ? (
        <p className="text-[clamp(1.4rem,3.2vmin,2.4rem)] font-bold leading-tight tracking-[-0.02em]" style={{ color: AZUL_PROFUNDO }}>
          {servicio}
        </p>
      ) : null}
    </div>
  )
}

function Lema() {
  const filete = { backgroundColor: `${AZUL_MEDIO}40` }
  return (
    <>
      <span aria-hidden className="hidden h-12 w-px 2xl:block" style={filete} />
      <div className="hidden items-center gap-4 2xl:flex">
        <Heartbeat size="2.5rem" weight="regular" style={{ color: AZUL_PROFUNDO }} />
        <span aria-hidden className="h-12 w-px" style={filete} />
        <p className="text-[clamp(0.8rem,1.6vmin,1.15rem)] font-medium leading-tight" style={{ color: AZUL_MEDIO }}>
          Cuidamos
          <br />
          tu bienestar
        </p>
      </div>
    </>
  )
}

/**
 * Los avisos del pie, tal como los aprobo el hospital. Texto fijo a proposito:
 * es la letra pequeña que ordena la sala, no el mensaje del dia.
 */
const AVISOS = [
  { Icono: UsersThree, lineas: ['Por favor, mantenga', 'el orden y espere su turno.'] },
  { Icono: Clock, lineas: ['Si su turno no aparece,', 'consulte en recepcion.'] },
  { Icono: HandHeart, lineas: ['Gracias por su paciencia', 'y comprension.'] },
]

/**
 * La banda de avisos: texto de cortesia, solo en pantallas con alto de sobra.
 * `compacto` (muchas filas) la deja en un renglon: ese alto es el que deja
 * caber los turnos.
 */
export function PieCartelera({ compacto }: { compacto: boolean }) {
  return (
    <footer
      className={cn(
        'relative z-10 mx-[2.5vmin] mb-[2vmin] hidden shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-[1.25rem] [@media(min-height:900px)]:flex',
        compacto ? 'px-8 py-2' : 'px-10 py-5',
      )}
      style={{ backgroundColor: AZUL_CLARO }}
    >
      {AVISOS.map(({ Icono, lineas }, indice) => (
        <div key={lineas[0]} className="flex min-w-0 items-center gap-4">
          {indice > 0 ? <span aria-hidden className="mr-2 hidden h-10 w-px lg:block" style={{ backgroundColor: `${AZUL_MEDIO}33` }} /> : null}
          <Icono size={compacto ? '1.5rem' : '2.1rem'} weight="regular" style={{ color: AZUL_MEDIO }} className="shrink-0" />
          <p className="text-[clamp(0.72rem,1.4vmin,1rem)] font-medium leading-snug tracking-[0.01em] text-slate-700">
            {lineas[0]}
            {compacto ? ' ' : <br />}
            {lineas[1]}
          </p>
        </div>
      ))}
      {/* El lema, remate de la pieza aprobada: no dice nada operativo y por eso va al final. */}
      <p
        className={cn('shrink-0 text-right font-semibold italic leading-tight', compacto ? 'text-[clamp(0.8rem,1.6vmin,1.1rem)]' : 'text-[clamp(1rem,2.2vmin,1.6rem)]')}
        style={{ color: AZUL_MEDIO }}
      >
        Juntos por {compacto ? null : <br />}su salud
      </p>
    </footer>
  )
}

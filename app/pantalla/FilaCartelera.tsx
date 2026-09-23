'use client'

/**
 * Una fila de la CARTELERA y el encabezado de su columna.
 *
 * Las medidas salen del plan (`planDeCartelera`), en pixeles: la letra es la
 * mayor que cabe en esta pantalla con este numero de consultorios, y las
 * celdas son las que el plan ya comprobo que alcanzan. Aqui solo se pintan.
 *
 * Jerarquia, de lo que mas a lo que menos se busca: el TURNO (el mas grande y
 * pesado), el CONSULTORIO (a donde ir, en su pastilla), el MEDICO y, pequeño y
 * secundario, el servicio.
 */
import type { CSSProperties } from 'react'
import { leerLugarYNumero } from '@/lib/turnos/nombre-consultorio'
import { Door, MapPin, Stethoscope, User } from '@phosphor-icons/react/dist/ssr'
import type { FormaDeFila, PlanDeCartelera } from '@/lib/turnos/distribucion-pantalla'
import type { CasillaPantalla } from '@/lib/turnos/types'
import { cn } from '@/lib/ui'
import { AZUL_CLARO, AZUL_FILA_ACTUAL, AZUL_MEDIO, AZUL_PROFUNDO, FONDO_FILA } from './colores-cartelera'

type Reja = Pick<PlanDeCartelera, 'forma' | 'reja' | 'rellenoX' | 'separacionCeldas'>

/** La reja de una fila. Una sola para el encabezado y las filas, o se desalinean. */
function estiloDeReja({ reja, rellenoX, separacionCeldas }: Reja): CSSProperties {
  return {
    gridTemplateColumns: reja.map((ancho) => `${ancho}px`).join(' '),
    columnGap: separacionCeldas,
    paddingInline: rellenoX,
  }
}

/** Los titulos de cada forma de fila, en el orden de sus celdas (ver `filas-de-cartelera.ts`). */
const TITULOS: Record<FormaDeFila, ReadonlyArray<{ Icono: typeof User; texto: string; conNumero?: boolean }>> = {
  'una-planta': [
    { Icono: User, texto: 'Turno' },
    { Icono: Stethoscope, texto: 'Medico' },
    // Encima de la columna del consultorio: "Consultorio" y, a la derecha,
    // "N°", sobre la cajita del numero.
    { Icono: Door, texto: 'Consultorio', conNumero: true },
  ],
  // En dos pisos el medico va debajo del consultorio y se entiende solo; un
  // titulo mas largo se cortaba en las columnas angostas.
  'dos-pisos': [
    { Icono: User, texto: 'Turno' },
    { Icono: Door, texto: 'Consultorio', conNumero: true },
  ],
}

/** Los titulos de una columna de filas: icono y palabra, en blanco sobre el azul profundo. */
export function EncabezadoDeColumna({ reja }: { reja: Reja }) {
  return (
    <div className="grid items-center py-[0.9rem]" style={estiloDeReja(reja)}>
      {TITULOS[reja.forma].map(({ Icono, texto, conNumero }) => (
        <Titulo key={texto} Icono={Icono} texto={texto} conNumero={conNumero} />
      ))}
    </div>
  )
}

function Titulo({ Icono, texto, conNumero }: { Icono: typeof User; texto: string; conNumero?: boolean }) {
  return (
    // El encabezado crece con la pantalla (2,8 % del lado corto: ~30 px en
    // 1080p) y no con la letra de las filas: si dependiera de ella, al medirse
    // cambiaria el espacio de las filas y otra vez su letra.
    <div className="flex min-w-0 items-center gap-[0.5em] text-[max(1.3rem,2.8vmin)] text-white">
      <Icono size="1.3em" weight="fill" className="shrink-0 opacity-90" />
      <span className="truncate font-bold tracking-[0.01em]">{texto}</span>
      {conNumero ? <span className="ml-auto shrink-0 pr-[0.4em] font-bold">N°</span> : null}
    </div>
  )
}

type FilaProps = {
  casilla: CasillaPantalla
  plan: PlanDeCartelera
  /** El turno en curso: la unica fila con fondo de color. */
  destacada: boolean
  /** Recien llamado: se resalta unos segundos. */
  resaltada: boolean
}

/**
 * La destacada y las demas son EL MISMO componente con distinto tono, no dos
 * bloques parecidos: si estuvieran escritas aparte, bastaria tocar una para
 * que la tabla se viera torcida desde la sala.
 */
export function FilaCartelera({ casilla, plan, destacada, resaltada }: FilaProps) {
  return (
    <div
      className={cn(
        'resalte-tv grid min-h-0 items-center overflow-hidden rounded-[1.1rem] transition-[background-color,box-shadow] duration-700 ease-[var(--curva)]',
        resaltada && 'llamado-tv ring-[0.3rem] ring-inset ring-amber-300',
      )}
      style={{ ...estiloDeReja(plan), backgroundColor: destacada ? AZUL_FILA_ACTUAL : FONDO_FILA }}
    >
      <CodigoDeTurno codigo={casilla.codigo} tamano={plan.letra.turno} destacada={destacada} resaltada={resaltada} />
      {plan.forma === 'dos-pisos' ? (
        // A donde ir arriba, con quien debajo: la misma jerarquia, apilada.
        <div className="flex min-w-0 flex-col items-start" style={{ gap: plan.separacionPisos }}>
          <Consultorio nombre={casilla.moduloNombre} tamano={plan.letra.consultorio} destacada={destacada} />
          <Medico casilla={casilla} plan={plan} destacada={destacada} />
        </div>
      ) : (
        <>
          <Medico casilla={casilla} plan={plan} destacada={destacada} />
          <Consultorio nombre={casilla.moduloNombre} tamano={plan.letra.consultorio} destacada={destacada} />
        </>
      )}
    </div>
  )
}

/**
 * El codigo NUNCA se parte: el plan reservo su ancho completo. Cifras de
 * ancho fijo, para que no baile de "C-011" a "C-008". Al resaltarse crece un
 * poco, sin rebote; con movimiento reducido, solo cambia de color.
 */
function CodigoDeTurno({ codigo, tamano, destacada, resaltada }: { codigo?: string | null; tamano: number; destacada: boolean; resaltada: boolean }) {
  return (
    <span
      data-cifras
      className={cn(
        'resalte-tv justify-self-start whitespace-nowrap rounded-[0.2em] px-[0.35em] py-[0.12em] font-bold leading-none tracking-[-0.02em] transition-transform duration-700 ease-[var(--curva)] origin-left',
        resaltada && 'scale-[1.04]',
      )}
      style={{
        fontSize: tamano,
        ...(destacada ? { backgroundColor: AZUL_PROFUNDO, color: '#FFFFFF' } : { backgroundColor: AZUL_CLARO, color: AZUL_PROFUNDO }),
      }}
    >
      {codigo}
    </span>
  )
}

/**
 * El nombre puede venir vacio: una ventanilla de fila compartida no tiene
 * medico. Se deja el hueco en vez de un guion que obligue a preguntarse que
 * significa. Un nombre largo pasa a DOS lineas antes que achicar la letra.
 */
function Medico({ casilla, plan, destacada }: { casilla: CasillaPantalla; plan: PlanDeCartelera; destacada: boolean }) {
  return (
    <div className="min-w-0">
      <p
        className={cn('line-clamp-2 break-words font-semibold leading-[1.1] tracking-[-0.01em]', destacada ? 'text-white' : 'text-slate-800')}
        style={{ fontSize: plan.letra.medico }}
      >
        {casilla.profesionalNombre ?? ''}
      </p>
    </div>
  )
}

/**
 * A donde ir: el lugar (el servicio) y, a la derecha y en su cajita, el NUMERO
 * del consultorio, que es lo que el paciente busca en la puerta. Todas las
 * pastillas ocupan el ancho entero de su columna: iguales, alineadas, y sin el
 * hueco vacio que dejaban a la derecha cuando cada una media su texto.
 */
function Consultorio({ nombre, tamano, destacada }: { nombre: string; tamano: number; destacada: boolean }) {
  const { lugar, numero } = leerLugarYNumero(nombre)
  return (
    <span
      className="flex w-full min-w-0 items-center gap-[0.3em] justify-self-stretch rounded-[0.6em] py-[0.2em] pl-[0.45em] pr-[0.2em]"
      style={{ fontSize: tamano, backgroundColor: destacada ? '#FFFFFF' : AZUL_CLARO }}
    >
      <MapPin size="0.85em" weight="fill" className="shrink-0" style={{ color: AZUL_MEDIO }} />
      <span className="line-clamp-2 min-w-0 flex-1 break-words font-bold leading-[1.1] tracking-[-0.01em]" style={{ color: AZUL_PROFUNDO }}>
        {lugar}
      </span>
      {/* El numero, en cifras de ancho fijo: todas las cajitas miden lo mismo. */}
      <span
        data-cifras
        className="ml-auto min-w-[2.1em] shrink-0 rounded-[0.35em] px-[0.2em] text-center font-black leading-none tracking-[-0.02em]"
        style={{ fontSize: '1.1em', backgroundColor: AZUL_PROFUNDO, color: '#FFFFFF', visibility: numero ? 'visible' : 'hidden' }}
      >
        {numero ?? '0'}
      </span>
    </span>
  )
}

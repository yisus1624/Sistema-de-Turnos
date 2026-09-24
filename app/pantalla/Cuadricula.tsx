'use client'

/**
 * Diseño "CUADRICULA" del televisor: una casilla fija por consultorio o
 * ventanilla, agrupadas por servicio.
 *
 * SE AJUSTA A CUALQUIER TELEVISOR. Mide el espacio real que tiene y reparte
 * las casillas con `planDeCuadricula`: la letra es la mayor que cabe en cada
 * tarjeta, medida contra la pantalla y nunca por debajo de lo que se lee desde
 * el fondo de la sala, asi que nada se recorta ni se solapa, en horizontal o
 * en vertical. Si ni con la letra minima caben todas, rota paginas con un
 * indicador "1/2"; nunca oculta ninguna.
 */
import { memo, useMemo, type ReactNode } from 'react'
import { claveDeCasilla } from '@/lib/turnos/casillas'
import type { Resaltes } from '@/lib/turnos/pantalla-tv'
import { EtiquetaNuevo } from './EtiquetaNuevo'
import type { CasillaPantalla } from '@/lib/turnos/types'
import { planDeCuadricula, type Espacio, type Letra, type PaginaDeCuadricula } from '@/lib/turnos/distribucion-pantalla'
import { cn } from '@/lib/ui'
import { useEspacioMedido, usePaginaRotativa } from './useDistribucion'
import IndicadorDePagina from './IndicadorDePagina'

interface Grupo {
  clave: string
  nombre: string
  casillas: CasillaPantalla[]
}

/**
 * Agrupadas por servicio, para que el paciente busque directo en la fila de su
 * especialidad. Las ventanillas (sin servicio fijo) van en su propio grupo. El
 * orden es el de llegada de cada servicio, el mismo en que el servidor entrega
 * los modulos.
 */
function agrupar(casillas: CasillaPantalla[]): Grupo[] {
  const mapa = new Map<string, Grupo>()
  for (const casilla of casillas) {
    const clave = casilla.servicioId || 'ventanilla'
    const grupo = mapa.get(clave)
    if (grupo) grupo.casillas.push(casilla)
    else mapa.set(clave, { clave, nombre: casilla.servicioNombre, casillas: [casilla] })
  }
  return Array.from(mapa.values())
}

export default function Cuadricula({
  casillas,
  pantalla,
  resaltes,
  mensajeVacio,
}: {
  casillas: CasillaPantalla[]
  /** La pantalla entera: la letra se mide contra ella. */
  pantalla: Espacio
  resaltes: Resaltes
  mensajeVacio: string
}) {
  const [espacio, medir] = useEspacioMedido()
  const grupos = useMemo(() => agrupar(casillas), [casillas])
  const ordenadas = useMemo(() => grupos.flatMap((g) => g.casillas.map((casilla) => ({ ...casilla, grupo: g.clave }))), [grupos])
  const plan = useMemo(() => planDeCuadricula(espacio, ordenadas, pantalla), [espacio, ordenadas, pantalla])
  // La pagina del consultorio recien llamado, para saltar a ella (ver `usePaginaRotativa`).
  const resaltado = resaltes.ultimo
  const indiceResaltado = ordenadas.findIndex((casilla) => claveDeCasilla(casilla) === resaltado)
  const paginaResaltada = plan.paginas.findIndex((p) => indiceResaltado >= p.desde && indiceResaltado < p.hasta)
  const numero = usePaginaRotativa(
    plan.paginas.length,
    resaltado && paginaResaltada >= 0 ? { clave: resaltado, pagina: paginaResaltada, vez: resaltes.contador } : null,
  )
  const pagina = plan.paginas[numero]
  const deLaPagina = ordenadas.slice(pagina.desde, pagina.hasta)
  // Sin etiquetas de servicio, un solo bloque: fue lo que hizo caber a todas.
  const gruposDeLaPagina = pagina.conEncabezados ? agrupar(deLaPagina) : [{ clave: 'todas', nombre: '', casillas: deLaPagina }]

  return (
    <div className="relative z-10 min-h-0 flex-1 p-[2vmin]">
      {/* Sin medir aun, el plan saldria de un espacio supuesto: mejor un instante en blanco. */}
      <div ref={medir} className={cn('relative h-full overflow-hidden', espacio.ancho === 0 && 'invisible')}>
        {casillas.length === 0 ? (
          <div className="grid h-full place-items-center">
            <p className="text-2xl font-bold text-slate-600">{mensajeVacio}</p>
          </div>
        ) : (
          <div className="flex h-full flex-col" style={{ gap: plan.separacion }}>
            {gruposDeLaPagina.map((grupo) => (
              <section key={grupo.clave} className="flex flex-col" style={{ gap: plan.separacion }}>
                {pagina.conEncabezados ? <EncabezadoDeGrupo nombre={grupo.nombre} alto={plan.altoEncabezado} /> : null}
                <Tarjetas pagina={pagina} separacion={plan.separacion}>
                  {grupo.casillas.map((casilla) => (
                    <Casilla
                      key={claveDeCasilla(casilla)}
                      casilla={casilla}
                      letra={pagina.letra}
                      resaltada={resaltes.resaltados.has(claveDeCasilla(casilla))}
                      nueva={resaltes.nuevos.has(claveDeCasilla(casilla))}
                    />
                  ))}
                </Tarjetas>
              </section>
            ))}
          </div>
        )}
        <IndicadorDePagina actual={numero} total={plan.paginas.length} />
      </div>
    </div>
  )
}

/** La etiqueta de un servicio: su alto lo fija el plan, y la letra, la mitad de ese alto. */
function EncabezadoDeGrupo({ nombre, alto }: { nombre: string; alto: number }) {
  return (
    <h2
      className="flex w-fit max-w-full shrink-0 items-center rounded-full bg-brand-100 px-[1em] font-extrabold uppercase leading-none tracking-[0.03em] text-brand-900"
      style={{ height: alto, fontSize: Math.round(alto * 0.5) }}
    >
      <span className="truncate">{nombre}</span>
    </h2>
  )
}

function Tarjetas({ pagina, separacion, children }: { pagina: PaginaDeCuadricula; separacion: number; children: ReactNode }) {
  return (
    <div
      className="grid"
      style={{
        gap: separacion,
        gridTemplateColumns: `repeat(${pagina.columnas}, minmax(0, 1fr))`,
        gridAutoRows: `${pagina.altoTarjeta}px`,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Una banda de texto de la tarjeta (consultorio o medico). Relleno y alto de
 * linea en `em`, los mismos del plan; un texto largo pasa a dos lineas.
 */
function Banda({ texto, tamano, className }: { texto: string; tamano: number; className: string }) {
  return (
    <div className={cn('shrink-0 px-[0.5em] py-[0.4em] text-center leading-[1.12]', className)} style={{ fontSize: tamano }}>
      <span className="line-clamp-2 break-words">{texto}</span>
    </div>
  )
}

/**
 * Una casilla: un consultorio o ventanilla, fijo en su lugar.
 *
 * Responde a las dos preguntas del paciente: QUE TURNO va (el codigo, enorme)
 * y A DONDE ENTRA (el nombre del consultorio, que es lo que esta escrito en la
 * puerta). El medico va al pie, con menos peso; nada del paciente aparece
 * aqui. Memorizada: cada llamado cambia UNA casilla, no las veinte.
 */
const Casilla = memo(function Casilla({
  casilla,
  letra,
  resaltada,
  nueva,
}: {
  casilla: CasillaPantalla
  letra: Letra
  resaltada: boolean
  nueva: boolean
}) {
  const ocupada = Boolean(casilla.codigo)
  return (
    <div
      className={cn(
        'resalte-tv relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] bg-white transition-shadow duration-700 ease-[var(--curva)]',
        ocupada && resaltada && 'llamado-tv',
        ocupada && resaltada
          ? 'shadow-[0_0_0_0.3rem_rgb(52,211,153),0_12px_32px_rgba(10,38,52,.18)]'
          : 'shadow-[0_0_0_1px_rgba(10,38,52,.07),0_4px_14px_rgba(10,38,52,.07)]',
      )}
    >
      <Banda
        texto={casilla.moduloNombre}
        tamano={letra.consultorio}
        className={cn('font-extrabold uppercase tracking-[-0.01em]', ocupada ? 'bg-brand-100 text-brand-900' : 'bg-slate-100 text-slate-600')}
      />
      {ocupada && nueva ? <EtiquetaNuevo tamano={letra.turno * 0.28} className="right-[0.5rem] top-[0.5rem]" /> : null}
      {ocupada ? <Ocupada casilla={casilla} letra={letra} resaltada={resaltada} /> : <Libre tamano={letra.medico} />}
    </div>
  )
})

/**
 * EL TURNO ES EL DATO DE LA PANTALLA, con cifras de ancho fijo: con cifras
 * proporcionales el numero cambia de ancho al pasar de "A-11" a "A-08" y da un
 * salto lateral en cada actualizacion. Nunca se parte en dos lineas.
 */
function Ocupada({ casilla, letra, resaltada }: { casilla: CasillaPantalla; letra: Letra; resaltada: boolean }) {
  return (
    <>
      <div className="grid min-h-0 flex-1 place-items-center bg-brand-950 px-[0.4em]" style={{ fontSize: letra.turno }}>
        <span
          data-cifras
          className={cn(
            'resalte-tv whitespace-nowrap font-black leading-none tracking-[-0.03em] text-white transition-transform duration-700 ease-[var(--curva)]',
            resaltada && 'scale-[1.04]',
          )}
        >
          {casilla.codigo}
        </span>
      </div>
      {casilla.profesionalNombre ? (
        <Banda texto={casilla.profesionalNombre} tamano={letra.medico} className="bg-brand-900 font-semibold tracking-[-0.01em] text-white" />
      ) : null}
    </>
  )
}

function Libre({ tamano }: { tamano: number }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-slate-50 px-3">
      <span className="font-black uppercase tracking-wide text-slate-600" style={{ fontSize: tamano }}>
        Libre
      </span>
    </div>
  )
}

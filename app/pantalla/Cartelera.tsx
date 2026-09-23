'use client'

/**
 * Diseño "CARTELERA" del televisor de la sala de espera.
 *
 * Replica la pieza que aprobo el hospital: cabecera con la marca a la izquierda
 * y el servicio a la derecha, tabla central con el turno en curso destacado, y
 * una banda de avisos al pie (ver `MarcoCartelera`).
 *
 * SIN COLUMNA DE PACIENTE, Y NO ES UN OLVIDO. La pieza original traia una
 * columna con el nombre completo del paciente. Esta pantalla no tiene sesion y
 * la ve todo el que pase por el pasillo, asi que el nombre no sale de aqui: al
 * paciente se le identifica por su TURNO. `CasillaPantalla` ni siquiera
 * transporta el nombre, de modo que la regla no depende de que nadie se
 * acuerde de ella.
 *
 * Lee EXACTAMENTE los mismos datos que la cuadricula: no consulta nada ni
 * calcula turnos, solo los acomoda de otra manera.
 */
import { useMemo, type ReactNode } from 'react'
import { claveDeCasilla } from '@/lib/turnos/casillas'
import { conNombresDePantalla } from '@/lib/turnos/nombre-consultorio'
import { filasDeCartelera } from '@/lib/turnos/pantalla-tv'
import {
  POCAS_FILAS,
  ladoCorto,
  planDeCartelera,
  tablaConFoto,
  type Espacio,
  type PlanDeCartelera,
} from '@/lib/turnos/distribucion-pantalla'
import type { CasillaPantalla, ConfiguracionSistema } from '@/lib/turnos/types'
import { cn } from '@/lib/ui'
import { useEspacioMedido, usePaginaRotativa } from './useDistribucion'
import IndicadorDePagina from './IndicadorDePagina'
import { CabeceraCartelera, FotoCartelera, PieCartelera } from './MarcoCartelera'
import { EncabezadoDeColumna, FilaCartelera } from './FilaCartelera'
import { AZUL_PROFUNDO } from './colores-cartelera'

type CarteleraProps = {
  casillas: CasillaPantalla[]
  configuracion: ConfiguracionSistema
  /** Modulo cuyo turno se acaba de llamar; se resalta unos segundos. */
  resaltado: string | null
  hora: string | null
  /** Los mandos del televisor (sonido, pantalla completa), ya montados. */
  controles: ReactNode
  /** Lo que se lee sin ningun llamado: distinto si aun no llegaron datos. */
  mensajeSinLlamados: string
}

export default function Cartelera({ casillas: recibidas, configuracion, resaltado, hora, controles, mensajeSinLlamados }: CarteleraProps) {
  // "CONSULTORIO 1" en vez de "CONS 01- CONSULTA EXTERNA": solo lo que se pinta.
  const casillas = useMemo(() => conNombresDePantalla(recibidas, 'cartelera'), [recibidas])
  /*
   * TODOS los consultorios con turno en curso, del llamado mas reciente al mas
   * antiguo (ver `filasDeCartelera`): con muchas filas se reparten en columnas
   * y la letra se ajusta, en vez de esconder a nadie.
   */
  const { filas, masReciente } = useMemo(() => filasDeCartelera(casillas), [casillas])
  const servicio = masReciente?.servicioNombre ?? casillas[0]?.servicioNombre ?? ''

  return (
    <Pantalla ruta={configuracion.fondoPantalla}>
      {(pantalla) => (
        <>
          <CabeceraCartelera servicio={servicio} hora={hora} controles={controles} />
          <div className="relative z-10 flex min-h-0 flex-1 justify-end px-[2.5vmin] pb-[2vmin]">
            <Tabla filas={filas} pantalla={pantalla} resaltado={resaltado} mensajeSinLlamados={mensajeSinLlamados} />
          </div>
          {/* Con muchas filas el pie cede alto: es el que deja caberlas en una pagina. */}
          <PieCartelera compacto={filas.length > POCAS_FILAS && !tablaConFoto(filas.length, pantalla)} />
        </>
      )}
    </Pantalla>
  )
}

/** El lienzo: mide la pantalla entera, porque la letra se calcula contra ella. */
function Pantalla({ ruta, children }: { ruta: string; children: (pantalla: Espacio) => ReactNode }) {
  const [pantalla, medir] = useEspacioMedido()
  return (
    <main ref={medir} data-pantalla-tv className="relative flex h-screen flex-col overflow-hidden bg-white text-slate-900">
      <FotoCartelera ruta={ruta} />
      {children(pantalla)}
    </main>
  )
}

type TablaProps = {
  filas: CasillaPantalla[]
  pantalla: Espacio
  resaltado: string | null
  mensajeSinLlamados: string
}

/** Lo que queda para las filas: el hueco de la tabla menos su encabezado y su relleno. */
function espacioDeFilas(hueco: Espacio, altoEncabezado: number, relleno: number): Espacio {
  return { ancho: hueco.ancho - 2 * relleno, alto: hueco.alto - altoEncabezado - 2 * relleno }
}

/**
 * SE AJUSTA A CUALQUIER TELEVISOR. Con el hueco real de la tabla se decide la
 * letra, el alto de fila, las columnas y, como ultimo recurso, las paginas
 * que rotan (ver `planDeCartelera`).
 *
 * La tarjeta se ajusta a sus filas en vez de estirarse hasta el pie: con uno o
 * dos consultorios, antes quedaba una tabla casi vacia con filas delgadas.
 */
function Tabla({ filas, pantalla, resaltado, mensajeSinLlamados }: TablaProps) {
  const [hueco, medirHueco] = useEspacioMedido()
  const [encabezado, medirEncabezado] = useEspacioMedido()
  const relleno = Math.max(8, Math.round(ladoCorto(pantalla) * 0.011))
  const plan = useMemo(
    () => planDeCartelera(espacioDeFilas(hueco, encabezado.alto, relleno), filas, pantalla),
    [hueco, encabezado.alto, relleno, filas, pantalla],
  )
  const indiceResaltado = filas.findIndex((casilla) => claveDeCasilla(casilla) === resaltado)
  const numero = usePaginaRotativa(
    plan.paginas,
    resaltado && indiceResaltado >= 0 ? { clave: resaltado, pagina: Math.floor(indiceResaltado / plan.porPagina) } : null,
  )
  const visibles = filas.slice(numero * plan.porPagina, (numero + 1) * plan.porPagina)
  // Sin medir aun, el plan saldria de un espacio supuesto: mejor un instante en blanco que filas mal
  // repartidas. Invisible y no oculta, porque el encabezado tiene que seguir midiendose.
  const medida = hueco.ancho > 0 && pantalla.ancho > 0

  return (
    // La foto asoma al lado con 1 a 5 filas en pantallas panoramicas, y la
    // tabla empieza arriba: los turnos se van apilando con el mismo tamaño de
    // letra, en vez de un solo turno gigante en medio (ver `tablaConFoto`).
    <section ref={medirHueco} className={cn('relative h-full w-full min-w-0', tablaConFoto(filas.length, pantalla) && 'w-[80%]')}>
      <div
        className={cn(
          'absolute inset-x-0 flex max-h-full flex-col overflow-hidden rounded-[1.75rem]',
          'top-0',
          'bg-white shadow-[0_2px_10px_rgba(10,38,52,.06),0_24px_60px_rgba(11,59,122,.16)]',
          !medida && 'invisible',
        )}
      >
        <div ref={medirEncabezado} className="shrink-0" style={{ backgroundColor: AZUL_PROFUNDO, paddingInline: relleno }}>
          <Columnas plan={plan}>
            {Array.from({ length: plan.columnas }, (_, columna) => (
              <EncabezadoDeColumna key={columna} reja={plan} />
            ))}
          </Columnas>
        </div>
        <div className="relative min-h-0" style={{ padding: relleno }}>
          {visibles.length > 0 ? (
            <Filas visibles={visibles} plan={plan} resaltado={resaltado} />
          ) : (
            <p className="grid min-h-[30vmin] place-items-center px-8 text-center text-[clamp(0.95rem,2.1vmin,1.4rem)] font-medium text-slate-600">
              {mensajeSinLlamados}
            </p>
          )}
          <IndicadorDePagina actual={numero} total={plan.paginas} />
        </div>
      </div>
    </section>
  )
}

/** Las columnas de filas, del ancho que decidio el plan: el encabezado y las filas usan la misma. */
function Columnas({ plan, filas, children }: { plan: PlanDeCartelera; filas?: number; children: ReactNode }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${plan.columnas}, ${plan.anchoColumna}px)`,
        columnGap: plan.separacionColumnas,
        rowGap: plan.separacionFilas,
        ...(filas ? { gridAutoFlow: 'column', gridTemplateRows: `repeat(${filas}, ${plan.altoFila}px)` } : {}),
      }}
    >
      {children}
    </div>
  )
}

/**
 * SOLO EL RECIEN LLAMADO se pinta de color, y solo mientras dura su resalte.
 * Antes la primera fila quedaba azul todo el tiempo: la sala se acostumbraba a
 * ese azul y ya no notaba cuando cambiaba el turno. Ahora cada llamado pinta
 * SU fila, parpadea unos segundos y vuelve al color de las demas: el cambio de
 * color es lo que hace levantar la vista.
 */
function Filas({ visibles, plan, resaltado }: { visibles: CasillaPantalla[]; plan: PlanDeCartelera; resaltado: string | null }) {
  return (
    <Columnas plan={plan} filas={Math.ceil(visibles.length / plan.columnas)}>
      {visibles.map((casilla) => (
        <FilaCartelera
          key={claveDeCasilla(casilla)}
          casilla={casilla}
          plan={plan}
          destacada={resaltado === claveDeCasilla(casilla)}
          resaltada={resaltado === claveDeCasilla(casilla)}
        />
      ))}
    </Columnas>
  )
}

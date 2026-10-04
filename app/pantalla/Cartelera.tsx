'use client'

/**
 * Los dos diseños del televisor de la sala de espera, que son LA MISMA PIEZA:
 * cabecera con la marca a la izquierda y el servicio a la derecha, tabla
 * central sobre la imagen de fondo, y una banda de avisos al pie (ver
 * `MarcoCartelera`).
 *
 * - `turno` (diseño CARTELERA): turno, medico y consultorio.
 * - `paciente` (diseño CARTELERA_PACIENTE): nombre completo del paciente y
 *   consultorio, sin turno ni medico. Lo pidio el hospital. El nombre solo
 *   llega del servidor con este diseño elegido (ver `nombreParaPantalla`), asi
 *   que la cartelera de siempre sigue sin transportarlo.
 *
 * No consulta nada ni calcula turnos: solo acomoda las casillas.
 */
import { useMemo, type ReactNode } from 'react'
import { claveDeCasilla } from '@/lib/turnos/casillas'
import { conNombresDePantalla } from '@/lib/turnos/nombre-consultorio'
import { filasDeCartelera, type Resaltes } from '@/lib/turnos/pantalla-tv'
import {
  POCAS_FILAS,
  ladoCorto,
  planDeCartelera,
  tablaConFoto,
  type Espacio,
  type PlanDeCartelera,
  type TextosDeCasilla,
} from '@/lib/turnos/distribucion-pantalla'
import type { CasillaPantalla, ConfiguracionSistema } from '@/lib/turnos/types'
import { cn } from '@/lib/ui'
import { useEspacioMedido, usePaginaRotativa } from './useDistribucion'
import IndicadorDePagina from './IndicadorDePagina'
import { CabeceraCartelera, FotoCartelera, PieCartelera } from './MarcoCartelera'
import { EncabezadoDeColumna, FilaCartelera } from './FilaCartelera'
import { AZUL_PROFUNDO } from './colores-cartelera'

/** Que dice cada fila: el turno con su medico, o el nombre del paciente. */
export type VarianteCartelera = 'turno' | 'paciente'

type CarteleraProps = {
  casillas: CasillaPantalla[]
  /** Por defecto `turno`, la cartelera de siempre. */
  variante?: VarianteCartelera
  configuracion: ConfiguracionSistema
  /** Modulo cuyo turno se acaba de llamar; se resalta unos segundos. */
  resaltes: Resaltes
  hora: string | null
  /** Los mandos del televisor (sonido, pantalla completa), ya montados. */
  controles: ReactNode
  /** Lo que se lee sin ningun llamado: distinto si aun no llegaron datos. */
  mensajeSinLlamados: string
}

export default function Cartelera({ casillas: recibidas, variante = 'turno', configuracion, resaltes, hora, controles, mensajeSinLlamados }: CarteleraProps) {
  // "CONSULTORIO 1" en vez de "CONS 01- CONSULTA EXTERNA": solo lo que se pinta.
  const casillas = useMemo(() => conNombresDePantalla(recibidas, 'cartelera'), [recibidas])
  /*
   * TODOS los consultorios con turno en curso, del llamado mas reciente al mas
   * antiguo (ver `filasDeCartelera`): con muchas filas se reparten en columnas
   * y la letra se ajusta, en vez de esconder a nadie.
   */
  const { filas, masReciente } = useMemo(() => filasDeCartelera(casillas), [casillas])
  const servicio = masReciente?.servicioNombre ?? casillas[0]?.servicioNombre ?? ''
  /*
   * LA TABLA SE ARMA PARA TODOS LOS CONSULTORIOS DEL DIA, no solo para los que
   * estan llamando.
   *
   * Antes el plan se rehacia con cada llamado: con uno a cinco turnos la tabla
   * dejaba ver la foto, al sexto saltaba a todo el ancho, al noveno pasaba a
   * dos columnas y la tarjeta crecia hacia abajo fila a fila. Si dos o tres
   * consultorios llamaban a la vez, la sala veia la tabla rearmarse varias
   * veces seguidas y parecia que un turno salia y el otro no. Ahora la letra,
   * las columnas y el alto quedan fijos desde la primera hora (ver
   * `casillas`, que trae tambien los consultorios libres) y cada llamado solo
   * ocupa su lugar.
   */
  const referencia = casillas.length >= filas.length ? casillas : filas

  return (
    <Pantalla ruta={configuracion.fondoPantalla}>
      {(pantalla) => (
        <>
          <CabeceraCartelera servicio={servicio} hora={hora} controles={controles} />
          <div className="relative z-10 flex min-h-0 flex-1 justify-end px-[2.5vmin] pb-[2vmin]">
            <Tabla
              filas={filas}
              referencia={referencia}
              variante={variante}
              pantalla={pantalla}
              resaltes={resaltes}
              mensajeSinLlamados={mensajeSinLlamados}
            />
          </div>
          {/* Con muchas filas el pie cede alto: es el que deja caberlas en una pagina. */}
          <PieCartelera compacto={referencia.length > POCAS_FILAS && !tablaConFoto(referencia.length, pantalla)} />
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
  /** Todos los puestos del dia, libres incluidos: con ellos se arma la tabla (ver arriba). */
  referencia: CasillaPantalla[]
  variante: VarianteCartelera
  pantalla: Espacio
  resaltes: Resaltes
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
/**
 * Lo que el plan mide de cada fila. Con el paciente, su nombre ocupa el hueco
 * del medico (el mismo de dos lineas) y no hay codigo que reservar.
 */
function textosDeFila(casilla: CasillaPantalla, variante: VarianteCartelera): TextosDeCasilla {
  if (variante === 'turno') return casilla
  return { moduloNombre: casilla.moduloNombre, profesionalNombre: casilla.nombrePaciente ?? '', codigo: null }
}

function Tabla({ filas, referencia, variante, pantalla, resaltes, mensajeSinLlamados }: TablaProps) {
  const resaltado = resaltes.ultimo
  const [hueco, medirHueco] = useEspacioMedido()
  const [encabezado, medirEncabezado] = useEspacioMedido()
  const relleno = Math.max(8, Math.round(ladoCorto(pantalla) * 0.011))
  const plan = useMemo(
    () =>
      planDeCartelera(
        espacioDeFilas(hueco, encabezado.alto, relleno),
        referencia.map((casilla) => textosDeFila(casilla, variante)),
        pantalla,
        { sinTurno: variante === 'paciente' },
      ),
    [hueco, encabezado.alto, relleno, referencia, pantalla, variante],
  )
  // Las paginas, por los turnos que SI hay: el plan las conto con los puestos
  // libres, y rotar a una pagina vacia es perder diez segundos de la sala.
  const paginas = Math.max(1, Math.ceil(filas.length / plan.porPagina))
  // Las filas de cada columna, fijas: la primera columna se llena antes de
  // empezar la segunda, y un turno nuevo no reparte a los demas de columna.
  const filasPorColumna = Math.ceil(Math.min(referencia.length, plan.porPagina) / plan.columnas)
  const indiceResaltado = filas.findIndex((casilla) => claveDeCasilla(casilla) === resaltado)
  const numero = usePaginaRotativa(
    paginas,
    resaltado && indiceResaltado >= 0 ? { clave: resaltado, pagina: Math.floor(indiceResaltado / plan.porPagina), vez: resaltes.contador } : null,
  )
  const visibles = filas.slice(numero * plan.porPagina, (numero + 1) * plan.porPagina)
  // Sin medir aun, el plan saldria de un espacio supuesto: mejor un instante en blanco que filas mal
  // repartidas. Invisible y no oculta, porque el encabezado tiene que seguir midiendose.
  const medida = hueco.ancho > 0 && pantalla.ancho > 0

  return (
    // La foto asoma al lado con 1 a 5 filas en pantallas panoramicas, y la
    // tabla empieza arriba: los turnos se van apilando con el mismo tamaño de
    // letra, en vez de un solo turno gigante en medio (ver `tablaConFoto`).
    <section ref={medirHueco} className={cn('relative h-full w-full min-w-0', tablaConFoto(referencia.length, pantalla) && 'w-[80%]')}>
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
            {/* Un encabezado por cada columna de filas. */}
            {Array.from({ length: plan.columnas }, (_, columna) => (
              <EncabezadoDeColumna key={columna} reja={plan} variante={variante} />
            ))}
          </Columnas>
        </div>
        <div className="relative min-h-0" style={{ padding: relleno }}>
          {visibles.length > 0 ? (
            <Filas visibles={visibles} filasPorColumna={filasPorColumna} variante={variante} plan={plan} resaltes={resaltes} />
          ) : (
            <p className="grid min-h-[30vmin] place-items-center px-8 text-center text-[clamp(0.95rem,2.1vmin,1.4rem)] font-medium text-slate-600">
              {mensajeSinLlamados}
            </p>
          )}
          <IndicadorDePagina actual={numero} total={paginas} />
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
function Filas({
  visibles,
  filasPorColumna,
  variante,
  plan,
  resaltes,
}: {
  visibles: CasillaPantalla[]
  filasPorColumna: number
  variante: VarianteCartelera
  plan: PlanDeCartelera
  resaltes: Resaltes
}) {
  return (
    <Columnas plan={plan} filas={Math.max(1, filasPorColumna)}>
      {visibles.map((casilla) => (
        <FilaCartelera
          key={claveDeCasilla(casilla)}
          casilla={casilla}
          variante={variante}
          plan={plan}
          destacada={resaltes.resaltados.has(claveDeCasilla(casilla))}
          resaltada={resaltes.resaltados.has(claveDeCasilla(casilla))}
          nueva={resaltes.nuevos.has(claveDeCasilla(casilla))}
        />
      ))}
    </Columnas>
  )
}

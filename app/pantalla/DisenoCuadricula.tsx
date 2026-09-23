'use client'

/**
 * El diseño CUADRICULA completo: fondo, cabecera con la marca, el reloj y los
 * mandos, las casillas y el mensaje del pie. Recibe los datos ya listos: no
 * consulta nada ni decide quien suena, igual que la cartelera.
 */
import { useMemo, type ReactNode } from 'react'
import type { CasillaPantalla, ConfiguracionSistema } from '@/lib/turnos/types'
import type { Resaltes } from '@/lib/turnos/pantalla-tv'
import { Isotipo, NOMBRE_INSTITUCION, NOMBRE_SISTEMA } from '@/components/brand/Marca'
import { conNombresDePantalla } from '@/lib/turnos/nombre-consultorio'
import Cuadricula from './Cuadricula'
import FondoPantalla from './FondoPantalla'
import Reloj from './Reloj'
import { useEspacioMedido } from './useDistribucion'

export default function DisenoCuadricula({
  casillas: recibidas,
  configuracion,
  resaltes,
  mensajeVacio,
  controles,
}: {
  casillas: CasillaPantalla[]
  configuracion: ConfiguracionSistema
  resaltes: Resaltes
  mensajeVacio: string
  controles: ReactNode
}) {
  // "CONSULTORIO 1" en vez de "CONS 01- CONSULTA EXTERNA": solo lo que se pinta.
  const casillas = useMemo(() => conNombresDePantalla(recibidas, 'cuadricula'), [recibidas])
  // La pantalla entera: la letra de las casillas se mide contra ella.
  const [pantalla, medirPantalla] = useEspacioMedido()
  /*
   * EL FONDO DEJA DE SER GRIS Y PASA AL AZUL MUY CLARO DE LA CASA.
   *
   * Con `bg-slate-100`, un gris neutro, las fichas blancas se recortaban poco
   * y la pantalla entera se veia apagada —"de computador"—. El fondo
   * institucional (el mismo `--turnos-bg` del resto del sistema) es un azul lo
   * bastante claro para no competir y lo bastante tenido para que el blanco de
   * las fichas salte hacia delante. Ademas la sala de espera pasa a verse de la
   * misma familia que el resto de pantallas del hospital.
   */
  return (
    <main ref={medirPantalla} data-pantalla-tv className="relative flex h-screen flex-col overflow-hidden bg-[var(--turnos-bg)] text-slate-900">
      {/*
        La MISMA imagen institucional que la cartelera, pero mucho mas atenuada
        (ver `FondoPantalla`): aqui la pantalla la llenan fichas blancas y la
        foto solo asoma entre ellas. A esa intensidad aporta color y textura de
        fondo —la sala deja de verse como una hoja de calculo— sin quitarle ni
        un gramo de atencion a los turnos, que es lo unico que el paciente
        viene a leer.
      */}
      <FondoPantalla ruta={configuracion.fondoPantalla} intensidad="cuadricula" />

      {/*
        La cabecera se separa con su propia sombra en lugar de con una linea
        de 1px: a distancia, un filete gris no se ve, y la cabecera parecia
        pegada al contenido. Con sombra se lee como una barra apoyada encima.

        Semitransparente con desenfoque, para que la imagen de fondo se intuya
        por detras en vez de cortarse en seco contra una franja blanca.
      */}
      <header className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 bg-white/85 px-8 py-5 shadow-[0_1px_0_rgba(10,38,52,.06),0_6px_18px_rgba(10,38,52,.05)] backdrop-blur-md">
        <div className="flex items-center gap-4">
          <Isotipo size="3.5rem" />
          <div className="leading-tight">
            <p className="text-xl font-black tracking-[-0.02em] text-brand-800">{NOMBRE_SISTEMA}</p>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-slate-500">
              {NOMBRE_INSTITUCION}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <Reloj />
          {/* Los mismos mandos que la cartelera, desde un solo sitio. */}
          {controles}
        </div>
      </header>

      {/*
        UNA SECCION POR SERVICIO, y dentro las tarjetas de sus consultorios
        fluyendo en cuadricula.

        Antes cada servicio era una COLUMNA, con sus consultorios apilados. Eso
        se cae con la forma real del hospital: casi todo cuelga de consulta
        externa, asi que quedaba una sola columna angosta con diez consultorios
        en fila india y media pantalla vacia. Con `auto-fit` las tarjetas
        reparten el ancho disponible: diez consultorios de un mismo servicio se
        ven en dos o tres filas, y si mañana crean otro servicio aparece como
        una seccion mas, sin tocar codigo.

        TODOS los consultorios activos se muestran siempre, sin esconder
        ninguno: `Cuadricula` mide el espacio y ajusta columnas y letra a
        cualquier televisor (ver `planDeCuadricula`).
      */}
      <Cuadricula casillas={casillas} pantalla={pantalla} resaltes={resaltes} mensajeVacio={mensajeVacio} />

      {configuracion.mensajePie ? (
        <footer className="relative z-10 shrink-0 overflow-hidden whitespace-nowrap bg-brand-950 px-8 py-3 text-center text-lg font-medium tracking-[0.01em] text-white">
          {configuracion.mensajePie}
        </footer>
      ) : null}
    </main>
  )
}

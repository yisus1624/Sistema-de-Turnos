/**
 * Marca del sistema.
 *
 * El logo institucional es un archivo estatico en `public/img/`, no un servicio
 * externo: es una imagen unica que no cambia y el sistema debe seguir viendose
 * bien aunque la sede se quede sin internet.
 *
 * El logo del hospital es un circulo con fondo blanco, asi que sobre los fondos
 * oscuros (barra lateral, pantalla de sala de espera) se muestra dentro de un
 * disco blanco en lugar de recortado.
 */
import Image from 'next/image'

/**
 * El nombre institucional, partido en sus dos lineas naturales.
 *
 * La barra lateral lo muestra en dos renglones ("ESE Hospital" encima y la sede
 * debajo, mas grande), que es como se lee el nombre de verdad. Se parte aqui, y
 * no en la barra, para que el nombre completo siga teniendo UNA sola fuente en
 * vez de dos que se desincronicen el dia que cambie.
 */
export const NOMBRE_ENTIDAD = 'ESE Hospital'
export const NOMBRE_SEDE = 'San Rafael de Chinu'
export const NOMBRE_INSTITUCION = `${NOMBRE_ENTIDAD} ${NOMBRE_SEDE}`
export const NOMBRE_SISTEMA = 'Sistema de Turnos'
/** Lema institucional. Acompana a la marca donde hay sitio para el. */
export const LEMA_INSTITUCION = 'Tu salud, nuestra prioridad'

const RUTA_LOGO = '/img/logo-hospital.png'

type IsotipoProps = {
  /** En pixeles, o una medida CSS ("4rem") para que escale con la pantalla del televisor. */
  size?: number | string
  className?: string
}

/** Resolucion con la que se pide el logo cuando el tamaño viene en unidades CSS. */
const LOGO_INTRINSECO = 192

export function Isotipo({ size = 40, className }: IsotipoProps) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-white ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={RUTA_LOGO}
        alt={NOMBRE_INSTITUCION}
        width={typeof size === 'number' ? size : LOGO_INTRINSECO}
        height={typeof size === 'number' ? size : LOGO_INTRINSECO}
        className="h-full w-full object-contain"
        priority
      />
    </span>
  )
}

type LogotipoProps = {
  /** `claro` para fondos oscuros (barra lateral), `oscuro` para fondos claros. */
  tono?: 'claro' | 'oscuro'
  compacto?: boolean
  /**
   * Que nombre manda en la marca.
   *
   * `sistema` (el de siempre) pone arriba "Sistema de Turnos". `institucion`
   * pone arriba el nombre del hospital y anade el lema: es lo que va en la
   * cabecera de la barra lateral, donde a quien trabaja no hay que recordarle
   * en que sistema esta —lleva el dia entero dentro— sino dejarle ver de un
   * vistazo de que hospital es la pantalla que tiene delante.
   */
  variante?: 'sistema' | 'institucion'
  className?: string
}

export function Logotipo({
  tono = 'oscuro',
  compacto = false,
  variante = 'sistema',
  className,
}: LogotipoProps) {
  const claro = tono === 'claro'

  if (variante === 'institucion') {
    return (
      <span className={`flex min-w-0 items-center gap-3 ${className ?? ''}`}>
        <Isotipo size={compacto ? 38 : 44} />
        <span className="min-w-0">
          <span
            className={`block truncate text-[11px] font-semibold leading-tight tracking-[0.01em] ${
              claro ? 'text-brand-200' : 'text-slate-500'
            }`}
          >
            {NOMBRE_ENTIDAD}
          </span>
          <span
            className={`block truncate font-black leading-tight tracking-[-0.02em] ${
              compacto ? 'text-sm' : 'text-[15px]'
            } ${claro ? 'text-white' : 'text-brand-950'}`}
          >
            {NOMBRE_SEDE}
          </span>
          <span
            className={`block truncate text-[10px] font-medium leading-tight ${
              claro ? 'text-brand-300/80' : 'text-slate-400'
            }`}
          >
            {LEMA_INSTITUCION}
          </span>
        </span>
      </span>
    )
  }

  return (
    <span className={`flex min-w-0 items-center gap-3 ${className ?? ''}`}>
      <Isotipo size={compacto ? 36 : 44} />
      <span className="min-w-0">
        <span
          className={`block truncate font-black leading-tight tracking-[-0.02em] ${
            compacto ? 'text-sm' : 'text-base'
          } ${claro ? 'text-white' : 'text-brand-950'}`}
        >
          {NOMBRE_SISTEMA}
        </span>
        <span
          className={`block truncate text-[11px] font-semibold leading-tight ${
            claro ? 'text-brand-200' : 'text-slate-500'
          }`}
        >
          {NOMBRE_INSTITUCION}
        </span>
      </span>
    </span>
  )
}

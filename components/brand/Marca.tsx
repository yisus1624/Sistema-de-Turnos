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

export const NOMBRE_INSTITUCION = 'ESE Hospital San Rafael de Chinu'
export const NOMBRE_SISTEMA = 'Sistema de Turnos'

const RUTA_LOGO = '/img/logo-hospital.png'

type IsotipoProps = {
  size?: number
  className?: string
}

export function Isotipo({ size = 40, className }: IsotipoProps) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-white ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={RUTA_LOGO}
        alt={NOMBRE_INSTITUCION}
        width={size}
        height={size}
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
  className?: string
}

export function Logotipo({ tono = 'oscuro', compacto = false, className }: LogotipoProps) {
  const claro = tono === 'claro'

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

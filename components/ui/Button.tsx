import type { ButtonHTMLAttributes } from 'react'
import { CircleNotch } from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/ui'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'dark'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  variant?: ButtonVariant
  size?: ButtonSize
}

const variants: Record<ButtonVariant, string> = {
  /*
   * LA ACCION PRINCIPAL VA EN EL AZUL DE ACENTO, NO EN EL TEAL DE LA MARCA.
   *
   * El teal esta en la barra lateral, en los encabezados, en las etiquetas y
   * en media pantalla: cuando el boton que hay que pulsar lleva el mismo color
   * que el fondo que lo rodea, deja de sobresalir y hay que buscarlo. El azul
   * de acento se reserva para lo que se toca —la seccion activa, la pestaña
   * encendida, el anillo de foco y este boton—, asi que el ojo aprende un solo
   * color y lo encuentra en cualquier pantalla del sistema.
   */
  primary: 'bg-acento-600 text-white hover:bg-acento-700',
  secondary: 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-slate-700 hover:bg-slate-100',
  dark: 'bg-brand-950 text-white hover:bg-brand-900',
}

/*
 * El texto se aprieta un poco a medida que crece.
 *
 * Una etiqueta corta en grueso y con las letras muy separadas se lee como un
 * cartel, no como un boton. Cuanto mas grande es la letra, mas sobra el aire
 * entre caracteres: por eso el tamano grande cierra mas el espaciado que el
 * pequeno, y el pequeno lo ABRE un pelo, que es lo que necesita para no
 * apelmazarse.
 */
const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm tracking-[0.005em]',
  md: 'h-11 px-4 text-sm tracking-[-0.005em]',
  lg: 'h-12 px-5 text-base tracking-[-0.012em]',
  icon: 'h-10 w-10 p-0',
}

export function Button({
  loading = false,
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        /*
         * PESO 600, NO 900. Estaba en negra maxima, el grosor mas pesado que
         * existe, igual que los titulos de pagina: cuando todo pesa lo mismo,
         * el grosor deja de senalar nada y la pantalla se lee como un muro. En
         * semi-negrita el boton sigue siendo lo mas solido de su zona y ademas
         * se lee mejor de cerca, que es como se usa.
         *
         * LA PULSACION RESPONDE EN 110ms Y SOLO ELLA. Antes `transition` sin
         * apellido animaba TODAS las propiedades con la misma duracion, asi
         * que el encogido del clic tardaba lo mismo que un cambio de color y
         * llegaba tarde al dedo. Ahora el tamano va por su cuenta y corto
         * —que es lo unico que el dedo espera al instante— y el color se toma
         * su tiempo.
         */
        'inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold outline-none',
        'transition-[background-color,border-color,color,opacity] duration-[var(--suave)]',
        'active:scale-[.97] active:transition-transform active:duration-[var(--toque)]',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <CircleNotch size={18} className="animate-spin" /> : null}
      {children}
    </button>
  )
}

export default Button

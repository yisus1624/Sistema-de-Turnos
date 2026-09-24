'use client'

/**
 * Los avisos de la pantalla del doctor: el que ocupa la pantalla entera (enlace
 * rechazado, sin conexion, cambio de doctor) y el que va sobre las tarjetas.
 *
 * Viven aparte de `ConsultorioClient` para que la pantalla quede en lo que
 * hace —cargar, llamar, cerrar— y no en como se pinta cada aviso.
 */
import { Info, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'
import type { CambioDeDoctor } from '@/lib/consultorio/presentacion'
import { cn } from '@/lib/ui'

type TonoAviso = 'rojo' | 'ambar'

const COLOR_AVISO: Record<TonoAviso, string> = {
  rojo: 'bg-red-50 text-red-600',
  ambar: 'bg-amber-50 text-amber-600',
}

export function AvisoAPantallaCompleta({
  tono,
  titulo,
  descripcion,
  children,
}: {
  tono: TonoAviso
  titulo: string
  descripcion: string
  /** Lo que el doctor puede hacer desde el aviso, debajo del texto. */
  children?: React.ReactNode
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--turnos-bg)] px-6 text-center">
      <div className="max-w-md space-y-4">
        <div className={cn('mx-auto grid h-16 w-16 place-items-center rounded-2xl', COLOR_AVISO[tono])}>
          <WarningCircle size={32} weight="fill" />
        </div>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-brand-950">{titulo}</h1>
        <p className="text-sm leading-6 text-slate-600">{descripcion}</p>
        {children}
      </div>
    </main>
  )
}

/**
 * Lo que se ofrece bajo "Este enlace ya no es valido".
 *
 * Ese aviso ya no es un final: un rechazo puede ser pasajero (un freno del
 * servidor, un corte de un intermediario) y la pantalla lo sigue comprobando
 * sola. El boton es para no tener que esperar a la siguiente comprobacion.
 */
export function ComprobarDeNuevo({ comprobando, alComprobar }: { comprobando: boolean; alComprobar: () => void }) {
  return (
    <div className="space-y-4 pt-1">
      <p className="text-sm leading-6 text-slate-600">
        Si fue un corte pasajero, no hace falta que hagas nada: esta pantalla lo sigue comprobando y vuelve a entrar
        sola.
      </p>
      <Button onClick={alComprobar} loading={comprobando}>
        Reintentar
      </Button>
    </div>
  )
}

/**
 * La pantalla paso a ser de otro doctor (ver `cambioDeDoctor`).
 *
 * Ocupa la pantalla entera y pide un clic A PROPOSITO: si solo cambiaran los
 * datos, el doctor que seguia ahi veria pacientes ajenos como propios y podria
 * llamar o cerrar a los de otro. Antes de seguir, tiene que haber leido de
 * quien es ahora.
 */
export function AvisoDeCambioDeDoctor({ cambio, alContinuar }: { cambio: CambioDeDoctor; alContinuar: () => void }) {
  return (
    <AvisoAPantallaCompleta
      tono="ambar"
      titulo="Esta pantalla cambio de doctor"
      descripcion={`En este navegador se abrio el enlace de ${cambio.ahora}, y un navegador solo puede tener abierto un consultorio a la vez. Lo que veias de ${cambio.antes} ya no se muestra aqui, para que nadie llame ni cierre por error a los pacientes de otro.`}
    >
      <div className="space-y-4 pt-1">
        <p className="text-sm leading-6 text-slate-600">
          Si eres {cambio.antes}, vuelve a abrir tu enlace: este navegador pasara a tu consultorio.
        </p>
        <Button onClick={alContinuar}>Ver el consultorio de {cambio.ahora}</Button>
      </div>
    </AvisoAPantallaCompleta>
  )
}

const TONO_AVISO = {
  rojo: 'border-red-200 bg-red-50 text-red-800',
  ambar: 'border-amber-200 bg-amber-50 text-amber-800',
  azul: 'border-acento-100 bg-acento-50 text-acento-900',
} as const

/** Un aviso dentro de la pantalla, sobre las tarjetas. */
export function Aviso({
  tono,
  icono,
  children,
}: {
  tono: keyof typeof TONO_AVISO
  icono: 'alerta' | 'info'
  children: React.ReactNode
}) {
  const Icono = icono === 'alerta' ? WarningCircle : Info
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm leading-6', TONO_AVISO[tono])}>
      <Icono size={20} weight="fill" className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

'use client'

/**
 * Entrada de los medicos: el PIN de 6 digitos, y nada mas.
 *
 * El PIN ya dice quien es: no se elige el nombre ni se autoriza el equipo. Al
 * acertar, la pantalla saluda al medico por su nombre y lo lleva a su
 * consultorio, con sus pacientes de hoy.
 *
 * EQUIPO COMPARTIDO. Si en este navegador ya hay un medico dentro (el de la
 * mañana), se ofrece seguir como el o entrar como otro: el de la tarde pone
 * su PIN y no ve nada del anterior.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Backspace, ShieldCheck, SignIn, UserSwitch } from '@phosphor-icons/react'
import { Isotipo, NOMBRE_INSTITUCION } from '@/components/brand/Marca'
import { mensajeDeError, pedir } from '@/lib/api/cliente'
import { DIGITOS_PIN } from '@/lib/turnos/forma-pin'
import { cn } from '@/lib/ui'

export default function MedicoClient({ conPin }: { conPin: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--turnos-bg)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Isotipo size={52} className="mx-auto text-brand-600" />
          <h1 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-brand-950">Entrada de medicos</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">{NOMBRE_INSTITUCION}</p>
        </div>

        <div className="mt-6 rounded-[1.5rem] bg-white p-6 shadow-[0_2px_10px_rgba(10,38,52,.06),0_24px_60px_rgba(11,59,122,.12)] sm:p-8">
          {conPin ? <EntradaConPin /> : <SoloEnlaces />}
        </div>

        <div className="mt-5 flex justify-center">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-brand-700"
          >
            <ArrowLeft size={15} weight="bold" />
            Soy funcionario: iniciar sesion
          </Link>
        </div>
      </div>
    </main>
  )
}

function SoloEnlaces() {
  return (
    <div className="text-center">
      <p className="text-base font-semibold text-brand-950">El hospital esta usando enlaces</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Por ahora se entra al consultorio con el enlace que te envian. Si el hospital activa la entrada con PIN, la
        podras usar desde aqui.
      </p>
    </div>
  )
}

/** ¿Hay un medico dentro en este equipo? Lo dice el propio consultorio. */
function useSesionAbierta() {
  const [sesion, setSesion] = useState<{ nombre: string } | null | undefined>(undefined)
  useEffect(() => {
    let vigente = true
    pedir<{ profesional: { nombre: string } }>('/api/consultorio', { sinRedirigirAlLogin: true })
      .then((datos) => vigente && setSesion({ nombre: datos.profesional.nombre }))
      .catch(() => vigente && setSesion(null))
    return () => {
      vigente = false
    }
  }, [])
  return [sesion, setSesion] as const
}

function EntradaConPin() {
  const router = useRouter()
  const [sesion, setSesion] = useSesionAbierta()
  const [pin, setPin] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bienvenido, setBienvenido] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  const entrar = useCallback(
    async (completo: string) => {
      setEnviando(true)
      setError(null)
      try {
        const { nombre } = await pedir<{ nombre: string }>('/api/medico/pin', {
          method: 'POST',
          body: JSON.stringify({ pin: completo }),
          sinRedirigirAlLogin: true,
        })
        setBienvenido(nombre)
        // Un instante para que lea su nombre: asi sabe que entro como el.
        setTimeout(() => router.replace('/consultorio'), 1200)
      } catch (falla) {
        setPin('')
        setError(mensajeDeError(falla) ?? 'No se pudo entrar. Intenta de nuevo.')
        entrada.current?.focus()
      } finally {
        setEnviando(false)
      }
    },
    [router],
  )

  function escribir(valor: string) {
    const limpio = valor.replace(/\D/g, '').slice(0, DIGITOS_PIN)
    setPin(limpio)
    setError(null)
    if (limpio.length === DIGITOS_PIN && !enviando) void entrar(limpio)
  }

  async function soyOtro() {
    await pedir('/api/consultorio/sesion', { method: 'DELETE', sinRedirigirAlLogin: true }).catch(() => {})
    setSesion(null)
    setTimeout(() => entrada.current?.focus(), 50)
  }

  if (bienvenido) {
    return (
      <div className="py-6 text-center" role="status">
        <ShieldCheck size={44} weight="fill" className="mx-auto text-emerald-600" />
        <p className="mt-3 text-sm font-medium text-slate-500">Bienvenido</p>
        <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-brand-950">{bienvenido}</p>
        <p className="mt-2 text-sm text-slate-500">Abriendo tus pacientes de hoy...</p>
      </div>
    )
  }

  if (sesion === undefined) return <p className="py-10 text-center text-sm text-slate-500">Cargando...</p>

  if (sesion) {
    return (
      <div className="text-center">
        <p className="text-sm font-medium text-slate-500">En este equipo esta dentro</p>
        <p className="mt-1 text-xl font-semibold tracking-[-0.02em] text-brand-950">{sesion.nombre}</p>
        <div className="mt-6 grid gap-3">
          <button
            type="button"
            onClick={() => router.replace('/consultorio')}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white transition hover:bg-brand-700 active:scale-[.98]"
          >
            <SignIn size={18} weight="bold" />
            Continuar como {sesion.nombre}
          </button>
          <button
            type="button"
            onClick={() => void soyOtro()}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-brand-800 transition hover:bg-slate-50 active:scale-[.98]"
          >
            <UserSwitch size={18} weight="bold" />
            Soy otro medico
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <label htmlFor="pin" className="block text-center text-sm font-semibold text-brand-950">
        Escribe tu PIN de {DIGITOS_PIN} digitos
      </label>
      {/* Un solo campo real (teclado numerico, pegar, autocompletar) y los puntos como dibujo. */}
      <div className="relative mt-4" onClick={() => entrada.current?.focus()}>
        <input
          ref={entrada}
          id="pin"
          value={pin}
          onChange={(e) => escribir(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={DIGITOS_PIN}
          disabled={enviando}
          aria-describedby={error ? 'pin-error' : undefined}
          className="absolute inset-0 h-full w-full opacity-0"
        />
        <div className="flex justify-center gap-2.5" aria-hidden="true">
          {Array.from({ length: DIGITOS_PIN }, (_, i) => (
            <span
              key={i}
              className={cn(
                'grid h-14 w-11 place-items-center rounded-xl border-2 text-2xl font-bold transition',
                i < pin.length ? 'border-brand-500 bg-brand-50 text-brand-900' : 'border-slate-200 bg-white text-transparent',
                i === pin.length && !enviando && 'border-brand-300',
              )}
            >
              •
            </span>
          ))}
        </div>
      </div>

      {error ? (
        <p id="pin-error" role="alert" className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-center text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : (
        <p className="mt-4 text-center text-xs font-medium text-slate-400">
          {enviando ? 'Comprobando...' : 'El PIN te lo entrega el administrador del sistema.'}
        </p>
      )}

      <Teclado alPulsar={(cifra) => escribir(pin + cifra)} alBorrar={() => escribir(pin.slice(0, -1))} deshabilitado={enviando} />
    </div>
  )
}

/** Teclado en pantalla, para equipos tactiles o sin teclado numerico. */
function Teclado({ alPulsar, alBorrar, deshabilitado }: { alPulsar: (cifra: string) => void; alBorrar: () => void; deshabilitado: boolean }) {
  const tecla =
    'h-14 rounded-xl bg-slate-50 text-xl font-semibold text-brand-950 transition hover:bg-slate-100 active:scale-95 disabled:opacity-50'
  return (
    <div className="mx-auto mt-5 grid max-w-[17rem] grid-cols-3 gap-2.5">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((cifra) => (
        <button key={cifra} type="button" className={tecla} onClick={() => alPulsar(cifra)} disabled={deshabilitado}>
          {cifra}
        </button>
      ))}
      <span />
      <button type="button" className={tecla} onClick={() => alPulsar('0')} disabled={deshabilitado}>
        0
      </button>
      <button type="button" className={cn(tecla, 'grid place-items-center')} onClick={alBorrar} disabled={deshabilitado} aria-label="Borrar">
        <Backspace size={22} />
      </button>
    </div>
  )
}

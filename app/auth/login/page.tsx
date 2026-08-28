'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { Eye, EyeSlash, LockKey, User } from '@phosphor-icons/react'
import { AuthShell, FieldIcon } from '@/components/auth/AuthBrandPanel'
import { Isotipo, NOMBRE_INSTITUCION } from '@/components/brand/Marca'
import { loginSchema, type LoginInput } from '@/lib/validators/auth'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [cargando, setCargando] = useState(false)

  const form = useForm<LoginInput>({
    defaultValues: { usuario: '', password: '' },
    mode: 'onBlur',
  })

  async function iniciarSesion(values: LoginInput) {
    setError('')
    const parsed = loginSchema.safeParse(values)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos de acceso.')
      return
    }

    setCargando(true)
    const resultado = await signIn('credentials', {
      usuario: parsed.data.usuario,
      password: parsed.data.password,
      redirect: false,
    })

    if (resultado?.error) {
      setError('Usuario o contrasena incorrectos.')
      setCargando(false)
      return
    }

    router.replace('/auth/redirect')
    router.refresh()
  }

  return (
    <AuthShell>
      <form onSubmit={form.handleSubmit(iniciarSesion)} className="w-full">
        <div className="text-center lg:text-left">
          <Isotipo size={44} className="mx-auto text-brand-600 lg:mx-0" />
          <h1 className="mt-4 text-2xl font-black tracking-[-0.03em] text-brand-950">Iniciar sesion</h1>
          <p className="mt-1.5 text-sm font-medium text-slate-500">
            Acceso para funcionarios del {NOMBRE_INSTITUCION}.
          </p>
        </div>

        {error ? (
          <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-extrabold uppercase tracking-wide text-slate-700">Usuario</span>
            <span className="relative mt-1.5 block">
              <FieldIcon>
                <User size={19} />
              </FieldIcon>
              <input
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Tu nombre de usuario"
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-11 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                {...form.register('usuario')}
              />
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-extrabold uppercase tracking-wide text-slate-700">Contrasena</span>
            <span className="relative mt-1.5 block">
              <FieldIcon>
                <LockKey size={19} />
              </FieldIcon>
              <input
                type={verPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Ingresa tu contrasena"
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-11 pr-12 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                {...form.register('password')}
              />
              <button
                type="button"
                onClick={() => setVerPassword((valor) => !valor)}
                className="absolute right-2.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 active:scale-95"
                aria-label={verPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
              >
                {verPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={cargando}
          className="mt-6 h-12 w-full rounded-xl bg-brand-600 text-sm font-black text-white transition hover:bg-brand-700 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cargando ? 'Validando acceso...' : 'Entrar'}
        </button>

        <p className="mt-5 border-t border-slate-100 pt-4 text-center text-xs font-medium text-slate-500">
          Las cuentas las crea el administrador del sistema. Si no puedes entrar, comunicate con la
          oficina de sistemas.
        </p>
      </form>
    </AuthShell>
  )
}

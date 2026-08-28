'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { CaretLeft, CaretRight, List, SignOut } from '@phosphor-icons/react'
import { logoutAction } from '@/app/actions/auth'
import { Isotipo, Logotipo } from '@/components/brand/Marca'
import type { RolUsuario } from '@/lib/usuarios/types'
import { rolLabels, rolNav } from './navigation'
import { cn } from '@/lib/ui'

type AppShellProps = {
  rol: RolUsuario
  nombreUsuario?: string | null
  area?: string | null
  title: string
  description: string
  children: React.ReactNode
}

const CLAVE_SIDEBAR = 'turnos-sidebar-colapsado'

function esActiva(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function AppShell({
  rol,
  nombreUsuario,
  area,
  title,
  description,
  children,
}: AppShellProps) {
  const pathname = usePathname()
  const [sidebarColapsado, setSidebarColapsado] = useState(false)
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false)
  const [cerrandoSesion, setCerrandoSesion] = useState(false)

  useEffect(() => {
    setSidebarColapsado(localStorage.getItem(CLAVE_SIDEBAR) === 'true')
  }, [])

  useEffect(() => {
    setMenuMovilAbierto(false)
  }, [pathname])

  useEffect(() => {
    if (!menuMovilAbierto) return

    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = overflowPrevio
    }
  }, [menuMovilAbierto])

  function alternarSidebar() {
    setSidebarColapsado((actual) => {
      const siguiente = !actual
      localStorage.setItem(CLAVE_SIDEBAR, String(siguiente))
      return siguiente
    })
  }

  async function cerrarSesion() {
    if (cerrandoSesion) return

    setCerrandoSesion(true)
    try {
      await logoutAction()
    } catch (error) {
      console.error('No se pudo cerrar la sesion.', error)
      setCerrandoSesion(false)
    }
  }

  const iniciales = (nombreUsuario || rolLabels[rol]).slice(0, 2).toUpperCase()

  const navegacion = (
    <>
      {rolNav[rol].map((seccion) => (
        <div key={seccion.label}>
          <p
            className={cn(
              'px-3 text-[11px] font-black uppercase tracking-[0.09em] text-brand-200/60',
              sidebarColapsado && 'lg:sr-only',
            )}
          >
            {seccion.label}
          </p>
          <div className={cn('mt-2 space-y-1', sidebarColapsado && 'lg:mt-0 lg:flex lg:flex-col lg:items-center lg:gap-2 lg:space-y-0')}>
            {seccion.items.map((item) => {
              const activa = esActiva(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={sidebarColapsado ? item.label : undefined}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition active:scale-[.98]',
                    sidebarColapsado && 'lg:h-12 lg:w-12 lg:justify-center lg:gap-0 lg:px-0 lg:py-0',
                    activa ? 'bg-white text-brand-950' : 'text-brand-100 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <item.icon size={20} weight={activa ? 'fill' : 'regular'} className="shrink-0" />
                  <span className={cn('whitespace-nowrap', sidebarColapsado && 'lg:hidden')}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )

  const botonSalir = (
    <button
      type="button"
      onClick={cerrarSesion}
      disabled={cerrandoSesion}
      className={cn(
        'mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-brand-100 transition hover:bg-white/10 hover:text-white active:scale-[.98] disabled:cursor-wait disabled:opacity-70',
        sidebarColapsado && 'lg:h-12 lg:w-12 lg:justify-center lg:gap-0 lg:self-center lg:px-0 lg:py-0',
      )}
      aria-busy={cerrandoSesion}
      title="Cerrar sesion"
    >
      <SignOut size={20} className="shrink-0" />
      <span className={cn(sidebarColapsado && 'lg:hidden')}>
        {cerrandoSesion ? 'Cerrando sesion...' : 'Cerrar sesion'}
      </span>
    </button>
  )

  return (
    <main className="min-h-[100dvh] overflow-x-clip bg-[var(--turnos-bg)] text-slate-950">
      <button
        type="button"
        aria-label="Cerrar menu"
        className={cn(
          'fixed inset-0 z-40 touch-none bg-slate-950/50 transition-opacity duration-200 lg:hidden',
          menuMovilAbierto ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setMenuMovilAbierto(false)}
      />

      <aside
        id="menu-lateral"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[82vw] flex-col bg-[var(--turnos-sidebar)] px-4 py-6 text-white shadow-2xl transition-transform duration-300 ease-out lg:hidden',
          menuMovilAbierto ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-hidden={!menuMovilAbierto}
        inert={!menuMovilAbierto}
      >
        <div className="flex items-center justify-between gap-3">
          <Logotipo tono="claro" />
          <button
            type="button"
            onClick={() => setMenuMovilAbierto(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-brand-100 transition hover:bg-white/10 hover:text-white active:scale-95"
            aria-label="Ocultar menu"
          >
            <CaretLeft size={17} weight="bold" />
          </button>
        </div>

        <nav className="custom-scrollbar mt-7 flex-1 space-y-6 overflow-y-auto pr-1">{navegacion}</nav>
        {botonSalir}
      </aside>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/5 bg-[var(--turnos-sidebar)] py-5 text-white transition-[width,padding] duration-300 lg:flex',
          sidebarColapsado ? 'w-20 px-2.5' : 'w-[264px] px-4',
        )}
      >
        {sidebarColapsado ? (
          <button
            type="button"
            onClick={alternarSidebar}
            className="grid h-12 w-12 shrink-0 place-items-center self-center rounded-2xl bg-white text-brand-950 transition hover:bg-brand-50 active:scale-95"
            aria-label="Expandir menu lateral"
          >
            <CaretRight size={20} weight="bold" />
          </button>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Logotipo tono="claro" compacto />
            <button
              type="button"
              onClick={alternarSidebar}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-brand-100 transition hover:bg-white/10 hover:text-white active:scale-95"
              aria-label="Contraer menu lateral"
            >
              <CaretLeft size={17} weight="bold" />
            </button>
          </div>
        )}

        <nav className="sidebar-scrollbar mt-6 flex-1 space-y-5 overflow-y-auto pr-1">{navegacion}</nav>
        {botonSalir}
      </aside>

      <section
        inert={menuMovilAbierto}
        className={cn('min-w-0 transition-[padding] duration-300', sidebarColapsado ? 'lg:pl-20' : 'lg:pl-[264px]')}
      >
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-[var(--turnos-sidebar)] px-3 text-white lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMenuMovilAbierto(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-brand-50 transition hover:bg-white/10 active:scale-[.98]"
              aria-label="Abrir menu"
              aria-expanded={menuMovilAbierto}
              aria-controls="menu-lateral"
            >
              <List size={23} weight="bold" />
            </button>
            <Isotipo size={30} className="shrink-0 text-brand-400" />
            <span className="truncate text-sm font-black">{title}</span>
          </div>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-xs font-black text-brand-950">
            {iniciales}
          </span>
        </div>

        <header className="border-b border-slate-200/80 bg-[var(--turnos-bg)]/92 px-4 py-4 backdrop-blur md:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="hidden items-center gap-2 text-xs font-black text-brand-600 lg:flex">
                {rolLabels[rol]}
                {area ? (
                  <>
                    <CaretRight size={13} />
                    <span className="truncate text-slate-500">{area}</span>
                  </>
                ) : null}
              </div>
              <h1 className="truncate text-2xl font-black tracking-[-0.03em] text-brand-950 lg:mt-1">{title}</h1>
            </div>

            <div className="hidden items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 lg:flex">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-sm font-black text-brand-700">
                {iniciales.slice(0, 1)}
              </span>
              <span className="max-w-[170px]">
                <span className="block truncate text-sm font-black text-slate-800">{nombreUsuario || rolLabels[rol]}</span>
                <span className="block truncate text-xs font-semibold text-slate-500">{rolLabels[rol]}</span>
              </span>
            </div>
          </div>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
        </header>

        <div className="mx-auto w-full max-w-[1520px] px-4 py-5 pb-10 md:px-7 md:py-7 xl:px-8">{children}</div>
      </section>
    </main>
  )
}

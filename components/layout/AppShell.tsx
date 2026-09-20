'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { CaretDown, CaretLeft, CaretRight, List, SignOut, UserCircle } from '@phosphor-icons/react'
import { logoutAction } from '@/app/actions/auth'
import { Isotipo, Logotipo } from '@/components/brand/Marca'
import type { RolUsuario } from '@/lib/usuarios/types'
import { navDelUsuario, rolLabels } from './navigation'
import { cn } from '@/lib/ui'

type AppShellProps = {
  rol: RolUsuario
  nombreUsuario?: string | null
  area?: string | null
  title: string
  description: string
  /** Secciones permitidas del usuario; `null` = las propias de su rol. */
  secciones?: string[] | null
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
  secciones,
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

  const seccionesNav = navDelUsuario(rol, secciones)
  const hrefActivo = seccionesNav
    .flatMap((seccionNav) => seccionNav.items.map((item) => item.href))
    .filter((href) => esActiva(pathname, href))
    .sort((a, b) => b.length - a.length)[0]

  const navegacion = (
    <>
      {seccionesNav.map((seccionNav) => {
        const items = seccionNav.items

        return (
        <div key={seccionNav.label}>
          <p
            className={cn(
              /*
                Rotulo de grupo del menu ("Operacion", "Configuracion"). A
                11px y en mayusculas, la negra maxima cierra los huecos de las
                letras y la palabra se vuelve un borron; en semi-negrita
                mantiene la presencia y se lee. El espaciado amplio se queda,
                que es lo que hace legible una mayuscula pequena.
              */
              'px-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-brand-200/45',
              sidebarColapsado && 'lg:sr-only',
            )}
          >
            {seccionNav.label}
          </p>
          <div className={cn('mt-2 space-y-1', sidebarColapsado && 'lg:mt-0 lg:flex lg:flex-col lg:items-center lg:gap-2 lg:space-y-0')}>
            {items.map((item) => {
              const activa = item.href === hrefActivo
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={sidebarColapsado ? item.label : undefined}
                  className={cn(
                    /*
                      LA SECCION ACTIVA PESA MAS QUE LAS DEMAS.
                      Antes todas iban en negrita y solo cambiaba el fondo, asi
                      que "donde estoy" dependia de un solo indicio. Ahora la
                      activa sube de grosor y las otras bajan a peso medio: se
                      distingue de un vistazo incluso de reojo, y el menu deja
                      de leerse como un bloque uniforme de texto grueso.

                      El encogido responde en 110ms, no en los 150 genericos.
                    */
                    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm tracking-[-0.006em]',
                    /*
                      El color responde en el acto al pasar y al pulsar: la
                      curva de la casa es la misma que usa el resto del sistema,
                      y a 220ms el cambio se nota sin llamar la atencion.
                    */
                    'transition-[background-color,color] duration-[var(--suave)] ease-[var(--curva)]',
                    'active:scale-[.98] active:transition-transform active:duration-[var(--toque)]',
                    sidebarColapsado && 'lg:h-12 lg:w-12 lg:justify-center lg:gap-0 lg:px-0 lg:py-0',
                    /*
                      LA SECCION ACTIVA ES UNA PASTILLA AZUL, NO UN HUECO BLANCO.

                      En blanco sobre el fondo oscuro parecia un agujero
                      recortado en la barra y, de lejos, competia con el logo,
                      que tambien es blanco. En el teal de la marca tampoco
                      funcionaba: la barra entera ya es teal, asi que la pastilla
                      se confundia con su propio fondo. El azul de acento es el
                      unico color de la barra que no esta en ninguna otra parte
                      de ella, y por eso se ve antes que nada.

                      El degradado es minimo —dos tonos vecinos— pero es lo que
                      hace que la pastilla se lea como una tecla iluminada y no
                      como un rectangulo relleno. Hace el trabajo que aqui no
                      puede hacer una sombra: las sombras en botones y enlaces
                      estan desactivadas en todo el sistema (ver globals.css).
                    */
                    activa
                      ? 'bg-gradient-to-b from-acento-500 to-acento-600 font-semibold text-white'
                      : 'font-medium text-brand-100/85 hover:bg-white/[0.07] hover:text-white',
                  )}
                >
                  <item.icon size={20} weight={activa ? 'fill' : 'regular'} className="shrink-0" />
                  <span className={cn('whitespace-nowrap', sidebarColapsado && 'lg:hidden')}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
        )
      })}
    </>
  )

  /**
   * MI CUENTA, JUNTO A CERRAR SESION Y NO DENTRO DEL MENU.
   *
   * No es una seccion del sistema (no se reparte ni se quita: la necesita todo
   * el que tiene cuenta), asi que no sale del catalogo de `navDelUsuario`. Va
   * al pie, donde ya se buscan las cosas de la propia cuenta.
   */
  const enlaceMiCuenta = (
    <Link
      href="/mi-cuenta"
      title="Mi cuenta"
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition hover:bg-white/10 hover:text-white active:scale-[.98]',
        esActiva(pathname, '/mi-cuenta')
          ? 'font-semibold text-white'
          : 'font-medium text-brand-100',
        sidebarColapsado && 'lg:h-12 lg:w-12 lg:justify-center lg:gap-0 lg:self-center lg:px-0 lg:py-0',
      )}
    >
      <UserCircle size={20} className="shrink-0" />
      <span className={cn('whitespace-nowrap', sidebarColapsado && 'lg:hidden')}>Mi cuenta</span>
    </Link>
  )

  const botonSalir = (
    <button
      type="button"
      onClick={cerrarSesion}
      disabled={cerrandoSesion}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-brand-100 transition hover:bg-white/10 hover:text-white active:scale-[.98] disabled:cursor-wait disabled:opacity-70',
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

  /*
    El pie de la barra se separa del menu con una linea tenue. Ni la cuenta ni
    la salida son secciones del sistema, y sin esa separacion "Cerrar sesion"
    se leia como una seccion mas del menu, justo debajo de la ultima.
  */
  const pieDeBarra = (
    <div
      className={cn(
        'mt-4 space-y-1 border-t border-white/10 pt-3',
        sidebarColapsado && 'lg:flex lg:flex-col lg:items-center lg:space-y-2',
      )}
    >
      {enlaceMiCuenta}
      {botonSalir}
    </div>
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
          'fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[82vw] flex-col superficie-menu px-4 py-6 text-white shadow-2xl transition-transform duration-300 ease-out lg:hidden',
          menuMovilAbierto ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-hidden={!menuMovilAbierto}
        inert={!menuMovilAbierto}
      >
        <div className="flex items-center justify-between gap-3">
          <Logotipo tono="claro" variante="institucion" />
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
        {pieDeBarra}
      </aside>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/[0.07] superficie-menu py-5 text-white transition-[width,padding] duration-300 lg:flex',
          sidebarColapsado ? 'w-20 px-2.5' : 'w-[264px] px-4',
        )}
      >
        {/*
          LA CABECERA DE LA BARRA ES SOLO LA MARCA.

          El boton de plegar vivia aqui, pegado al logo, y eran dos cosas
          distintas compartiendo el sitio mas visible de la pantalla. Ahora
          plegar se hace desde la barra superior, junto al titulo, que es donde
          se mira cuando se quiere mas ancho para el contenido; aqui queda la
          identidad del hospital y nada mas.
        */}
        {sidebarColapsado ? (
          <Isotipo size={40} className="self-center" />
        ) : (
          <Logotipo tono="claro" variante="institucion" compacto />
        )}

        <nav className="sidebar-scrollbar mt-6 flex-1 space-y-5 overflow-y-auto pr-1">{navegacion}</nav>
        {pieDeBarra}
      </aside>

      <section
        inert={menuMovilAbierto}
        className={cn('min-w-0 transition-[padding] duration-300', sidebarColapsado ? 'lg:pl-20' : 'lg:pl-[264px]')}
      >
        {/*
          Barra de movil como MATERIAL, no como bloque opaco.

          Era del color solido del menu, asi que al bajar por una lista larga
          el contenido desaparecia de golpe bajo una franja ciega. Traslucida
          con desenfoque, lo que pasa por debajo se sigue intuyendo y la barra
          se lee como una capa flotando sobre la pagina: se entiende que hay
          contenido ahi arriba, no que la pantalla se acaba.

          `material-chrome-oscuro` vuelve al color solido por su cuenta si el
          equipo pide menos transparencia o mas contraste (ver globals.css).
        */}
        <div className="material-chrome-oscuro sticky top-0 z-30 flex h-14 items-center justify-between gap-3 px-3 text-white lg:hidden">
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
            <span className="truncate text-sm font-semibold">{title}</span>
          </div>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-xs font-medium text-brand-950">
            {iniciales}
          </span>
        </div>

        <header className="border-b border-slate-200/60 bg-[var(--turnos-bg)] px-4 pb-4 md:px-7">
          {/*
            BARRA SUPERIOR: PLEGAR A LA IZQUIERDA, LA CUENTA A LA DERECHA.

            Las dos cosas que no pertenecen a ninguna pantalla en concreto —el
            ancho del menu y quien tiene la sesion abierta— viven en la misma
            franja y siempre en el mismo sitio, por encima del titulo. Asi el
            bloque del titulo queda limpio: rastro, nombre de la pantalla y de
            que va, sin nada mas compitiendo a su lado.
          */}
          <div className="hidden items-center justify-between gap-4 py-3 lg:flex">
            <button
              type="button"
              onClick={alternarSidebar}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 transition-colors duration-[var(--suave)] ease-[var(--curva)] hover:bg-white hover:text-acento-600 active:scale-[.98] active:transition-transform active:duration-[var(--toque)]"
              aria-label={sidebarColapsado ? 'Expandir menu lateral' : 'Contraer menu lateral'}
              aria-expanded={!sidebarColapsado}
              title={sidebarColapsado ? 'Expandir menu lateral' : 'Contraer menu lateral'}
            >
              <List size={22} weight="bold" />
            </button>

            <div className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white px-3 py-2 shadow-[var(--sombra-sm)]">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-acento-50 text-sm font-semibold text-acento-700">
                {iniciales.slice(0, 1)}
              </span>
              <span className="max-w-[170px]">
                <span className="block truncate text-sm font-semibold text-slate-800">{nombreUsuario || rolLabels[rol]}</span>
                <span className="block truncate text-xs font-medium tracking-[0.01em] text-slate-500">{rolLabels[rol]}</span>
              </span>
              <CaretDown size={14} weight="bold" className="shrink-0 text-slate-300" aria-hidden="true" />
            </div>
          </div>

          <div className="min-w-0 pt-4 lg:pt-1">
            {/*
              El rastro de ubicacion (rol › area) es una referencia, no un
              titular: en negra maxima competia con el nombre de la pantalla
              que tiene justo debajo. Baja a peso medio y abre el espaciado,
              que es lo que pide un texto de 12px para leerse limpio.
            */}
            <div className="hidden items-center gap-2 text-xs font-medium tracking-[0.02em] text-brand-600 lg:flex">
              {rolLabels[rol]}
              {area ? (
                <>
                  <CaretRight size={13} />
                  <span className="truncate text-slate-500">{area}</span>
                </>
              ) : null}
            </div>
            {/*
              El nombre de la pantalla es lo mas grande que hay aqui, asi que
              el tamano ya manda: no necesita ademas el grosor maximo. En
              semi-negrita y algo mas apretado se lee como un titulo
              cuidado en vez de como un grito.
            */}
            <h1 className="truncate text-2xl font-semibold tracking-[-0.028em] text-brand-950 lg:mt-1">{title}</h1>
            <p className="mt-1.5 max-w-3xl text-sm leading-[1.65] text-slate-600">{description}</p>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1520px] px-4 py-5 pb-10 md:px-7 md:py-7 xl:px-8">{children}</div>
      </section>
    </main>
  )
}

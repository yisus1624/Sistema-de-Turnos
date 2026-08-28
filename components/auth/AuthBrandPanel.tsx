'use client'

import { ClockCounterClockwise, Megaphone, MonitorPlay, ShieldCheck, Ticket } from '@phosphor-icons/react'
import { Isotipo, NOMBRE_INSTITUCION, NOMBRE_SISTEMA } from '@/components/brand/Marca'

const capacidades = [
  { icon: Ticket, title: 'Turnos por servicio', text: 'Admisiones, facturacion, SIAU, laboratorio y mas' },
  { icon: Megaphone, title: 'Llamado desde ventanilla', text: 'El funcionario llama y repite el turno' },
  { icon: MonitorPlay, title: 'Pantalla en sala de espera', text: 'Turno actual, modulo y llamado por audio' },
  { icon: ClockCounterClockwise, title: 'Historico y estadisticas', text: 'Turnos atendidos, ausentes y tiempos' },
]

export function FieldIcon({ children }: { children: React.ReactNode }) {
  return <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">{children}</span>
}

export function AuthBrandPanel() {
  return (
    <aside className="relative hidden h-[100dvh] overflow-hidden bg-[var(--turnos-sidebar)] px-11 py-9 text-white lg:flex lg:flex-col xl:px-16 xl:py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_10%,rgba(65,164,194,.28),transparent_34%),radial-gradient(circle_at_88%_70%,rgba(28,134,168,.24),transparent_36%)]" />

      <div className="relative">
        <Isotipo size={56} className="text-brand-400" />
        <p className="mt-5 text-3xl font-black leading-tight tracking-[-0.03em] xl:text-4xl">{NOMBRE_SISTEMA}</p>
        <p className="mt-2 max-w-[300px] text-base leading-snug text-brand-100">{NOMBRE_INSTITUCION}</p>

        <nav className="mt-10 space-y-5 xl:mt-14 xl:space-y-7">
          {capacidades.map((item) => (
            <div key={item.title} className="flex items-start gap-4">
              <item.icon size={26} className="mt-0.5 shrink-0 text-brand-300" />
              <div>
                <p className="text-base font-extrabold">{item.title}</p>
                <p className="mt-1 text-sm text-brand-100/75">{item.text}</p>
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="relative mt-auto flex items-start gap-3 border-t border-white/10 pt-4">
        <ShieldCheck size={28} className="shrink-0 text-brand-200" />
        <div>
          <p className="text-base font-extrabold">Acceso solo para funcionarios</p>
          <p className="mt-1 text-sm text-brand-100/75">El sistema no almacena datos personales del paciente.</p>
        </div>
      </div>
    </aside>
  )
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-[var(--turnos-bg)] text-slate-950 lg:h-[100dvh] lg:overflow-hidden">
      <div className="grid min-h-[100dvh] w-full lg:h-[100dvh] lg:grid-cols-[420px_1fr] xl:grid-cols-[560px_1fr]">
        <AuthBrandPanel />
        <section className="relative grid min-h-[100dvh] place-items-center bg-white px-5 py-8 md:px-8 lg:h-[100dvh]">
          <div className="w-full max-w-[440px]">{children}</div>
        </section>
      </div>
    </main>
  )
}

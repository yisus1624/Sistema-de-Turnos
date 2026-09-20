'use client'

/**
 * Diseño "CARTELERA" del televisor de la sala de espera.
 *
 * Replica la pieza que aprobo el hospital: cabecera con la marca a la izquierda
 * y el servicio a la derecha, tabla central con el turno en curso destacado, y
 * una banda de avisos al pie.
 *
 * SIN COLUMNA DE PACIENTE, Y NO ES UN OLVIDO. La pieza original traia una
 * columna con el nombre completo del paciente. Esta pantalla no tiene sesion y
 * la ve todo el que pase por el pasillo, asi que el nombre no sale de aqui: al
 * paciente se le identifica por su TURNO, que es justo para lo que se le
 * entrega en admisiones. `CasillaPantalla` ni siquiera transporta el nombre, de
 * modo que la regla no depende de que nadie se acuerde de ella.
 *
 * El otro diseño —`CUADRICULA`, el de siempre, que vive en `page.tsx`— pinta
 * una casilla fija por consultorio y las muestra todas a la vez. Los dos leen
 * EXACTAMENTE los mismos datos: este archivo no consulta nada ni calcula
 * turnos, solo los acomoda de otra manera, asi que cambiar de diseño no altera
 * a quien se llama ni en que orden.
 */

import { useMemo } from 'react'
import {
  Clock,
  Door,
  HandHeart,
  Heartbeat,
  MapPin,
  Stethoscope,
  User,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr'
import type { CasillaPantalla, ConfiguracionSistema } from '@/lib/turnos/types'
import { Isotipo } from '@/components/brand/Marca'

/**
 * Cuantos llamados anteriores se listan debajo del actual.
 *
 * Cuatro, como la pieza aprobada: cinco filas en total. Mas no caben con letra
 * legible a la distancia de una sala de espera, y una lista larga y pequeña es
 * peor que una corta y clara para quien busca su turno de un vistazo.
 */
const ANTERIORES_VISIBLES = 4

/**
 * LOS AZULES DE LA PIEZA APROBADA.
 *
 * El resto del sistema usa el teal institucional (`brand`, en
 * tailwind.config.ts); esta pantalla se aparta a proposito, porque el hospital
 * aprobo la cartelera con estos azules y es lo que espera ver en la sala. Van
 * en constantes y no sueltos por el marcado para que cambiarlos —si algun dia
 * se unifican con el teal— sea tocar cuatro lineas y no cazarlos uno a uno.
 */
const AZUL_PROFUNDO = '#0B3B7A'
const AZUL_MEDIO = '#1B5FC1'
const AZUL_CLARO = '#EFF5FD'

/**
 * Los avisos del pie, tal como los aprobo el hospital.
 *
 * Texto fijo y no configurable a proposito: es la letra pequeña que ordena la
 * sala, no el mensaje del dia (ese es `mensajePie`, que va en la cabecera).
 */
const AVISOS = [
  { Icono: UsersThree, lineas: ['Por favor, mantenga', 'el orden y espere su turno.'] },
  { Icono: Clock, lineas: ['Si su turno no aparece,', 'consulte en recepcion.'] },
  { Icono: HandHeart, lineas: ['Gracias por su paciencia', 'y comprension.'] },
]

/** La reja de la tabla. Una sola, o la cabecera y las filas se desalinean. */
const COLUMNAS = 'grid-cols-[1fr,1.6fr,1.2fr]'

type CarteleraProps = {
  casillas: CasillaPantalla[]
  configuracion: ConfiguracionSistema
  /** Modulo cuyo turno se acaba de llamar; se resalta unos segundos. */
  resaltado: string | null
  hora: string | null
  /** Los mandos del televisor (sonido, pantalla completa), ya montados. */
  controles: React.ReactNode
}

export default function Cartelera({ casillas, configuracion, resaltado, hora, controles }: CarteleraProps) {
  /*
   * Los llamados, del mas reciente al mas antiguo.
   *
   * Se ordena por `horaLlamado` y no por el orden en que vienen las casillas,
   * que es alfabetico por consultorio: sin esto, "CONS 02" saldria siempre
   * encima de "CONS 15" aunque el de CONS 15 se acabara de llamar, y el
   * paciente miraria arriba para ver lo ultimo que ha pasado y ahi no estaria.
   */
  const llamados = useMemo(
    () =>
      casillas
        .filter((casilla) => Boolean(casilla.codigo))
        .sort((a, b) => (b.horaLlamado ?? '').localeCompare(a.horaLlamado ?? '')),
    [casillas],
  )

  const actual = llamados[0] ?? null
  const anteriores = llamados.slice(1, 1 + ANTERIORES_VISIBLES)

  /*
   * El rotulo grande de la derecha.
   *
   * Sale del servicio del turno que se esta llamando, no de un texto escrito a
   * mano: la pieza aprobada decia "Consulta Externa" porque ese era el ejemplo,
   * pero el mismo televisor sirve para odontologia o para las ventanillas. Si
   * aun no se ha llamado nada, se cae al servicio de la primera casilla.
   */
  const servicio = actual?.servicioNombre ?? casillas[0]?.servicioNombre ?? ''

  return (
    <main className="relative flex h-screen flex-col overflow-hidden bg-white text-slate-900">
      {/* ----------------------------------------------------------------
          FONDO: la fotografia a la izquierda, desvanecida hacia la derecha
          ---------------------------------------------------------------- */}
      {configuracion.fondoPantalla ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {/*
            Ocupa la mitad izquierda y se funde con el blanco antes de llegar al
            centro, como en la pieza aprobada: la tabla se apoya sobre fondo
            limpio y la fotografia no le compite, pero la pantalla tampoco se ve
            como un documento en blanco.

            La mascara es de OPACIDAD, no de color: no tiñe la foto, solo la va
            haciendo transparente hacia la derecha.
          */}
          <div
            className="absolute inset-y-0 left-0 w-[58%]"
            style={{
              maskImage: 'linear-gradient(to right, black 55%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, black 55%, transparent 100%)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- ruta configurable por el administrador */}
            <img src={configuracion.fondoPantalla} alt="" className="h-full w-full object-cover object-left" />
          </div>
          {/* Velo muy corto: la foto tiene que reconocerse, no mandar. */}
          <div className="absolute inset-0 bg-white/25" />
        </div>
      ) : null}

      {/* ----------------------------------------------------------------
          CABECERA
          ---------------------------------------------------------------- */}
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-8 px-10 py-5">
        <div className="flex min-w-0 items-center gap-5">
          <Isotipo size={76} />
          <div className="min-w-0">
            <p className="text-[clamp(0.9rem,1.9vmin,1.4rem)] font-medium leading-tight text-slate-700">
              ESE Hospital
            </p>
            <p
              className="truncate text-[clamp(1.4rem,3.2vmin,2.4rem)] font-bold leading-tight tracking-[-0.02em]"
              style={{ color: AZUL_PROFUNDO }}
            >
              San Rafael de Chinu
            </p>
            <p className="truncate text-[clamp(0.7rem,1.4vmin,1rem)] font-medium leading-tight text-slate-500">
              Tu salud, nuestra prioridad
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-7">
          <div className="text-right">
            <p className="text-[clamp(0.9rem,1.9vmin,1.4rem)] font-medium leading-tight text-slate-700">
              Turnos de Atencion
            </p>
            {servicio ? (
              <p
                className="text-[clamp(1.4rem,3.2vmin,2.4rem)] font-bold leading-tight tracking-[-0.02em]"
                style={{ color: AZUL_PROFUNDO }}
              >
                {servicio}
              </p>
            ) : null}
          </div>

          <span aria-hidden className="h-12 w-px" style={{ backgroundColor: `${AZUL_MEDIO}40` }} />

          <div className="flex items-center gap-4">
            <Heartbeat size={40} weight="regular" style={{ color: AZUL_PROFUNDO }} />
            <span aria-hidden className="h-12 w-px" style={{ backgroundColor: `${AZUL_MEDIO}40` }} />
            <p
              className="text-[clamp(0.8rem,1.6vmin,1.15rem)] font-medium leading-tight"
              style={{ color: AZUL_MEDIO }}
            >
              Cuidamos
              <br />
              tu bienestar
            </p>
          </div>

          {/*
            La hora y los mandos no estaban en la pieza aprobada —era una imagen
            fija—, pero el televisor de verdad los necesita: la hora orienta al
            paciente y los mandos son lo que se toca al abrir la sala. Van al
            final y en discreto, para no alterar la composicion.
          */}
          <div className="flex items-center gap-4 border-l border-slate-900/10 pl-6">
            {hora ? (
              <p data-cifras className="text-[clamp(1rem,2.1vmin,1.5rem)] font-semibold text-slate-700">
                {hora}
              </p>
            ) : null}
            {controles}
          </div>
        </div>
      </header>

      {/* ----------------------------------------------------------------
          TABLA DE TURNOS
          ---------------------------------------------------------------- */}
      <div className="relative z-10 flex min-h-0 flex-1 items-stretch justify-end px-10 pb-4">
        <section className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-[0_2px_10px_rgba(10,38,52,.06),0_24px_60px_rgba(11,59,122,.16)] lg:w-[72%]">
          <div
            className={`grid shrink-0 ${COLUMNAS} items-center gap-6 px-8 py-5`}
            style={{ backgroundColor: AZUL_PROFUNDO }}
          >
            <Encabezado Icono={User} texto="Turno" />
            <Encabezado Icono={Stethoscope} texto="Medico" />
            <Encabezado Icono={Door} texto="Consultorio" />
          </div>

          {actual ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
              {/*
                EL TURNO EN CURSO.

                Es la unica fila con fondo de color de toda la pantalla: en una
                sala de espera el paciente mira el televisor de reojo cada pocos
                segundos y tiene que resolver "¿me toca?" sin leer la lista
                entera. Si hubiera dos o tres colores compitiendo, ninguno
                haria ese trabajo.
              */}
              <Fila casilla={actual} destacada resaltada={resaltado === actual.moduloId} />

              {anteriores.map((casilla) => (
                <Fila key={casilla.moduloId} casilla={casilla} />
              ))}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 place-items-center px-8 py-12 text-center">
              <p className="text-[clamp(0.95rem,2.1vmin,1.4rem)] font-medium text-slate-400">
                Aun no se ha llamado ningun turno.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* ----------------------------------------------------------------
          BANDA DE AVISOS
          ---------------------------------------------------------------- */}
      <footer
        className="relative z-10 mx-10 mb-6 flex shrink-0 flex-wrap items-center justify-between gap-6 rounded-[1.25rem] px-10 py-5"
        style={{ backgroundColor: AZUL_CLARO }}
      >
        {AVISOS.map(({ Icono, lineas }, indice) => (
          <div key={lineas[0]} className="flex min-w-0 items-center gap-4">
            {/* Separador entre avisos, nunca antes del primero. */}
            {indice > 0 ? (
              <span
                aria-hidden
                className="mr-2 hidden h-10 w-px lg:block"
                style={{ backgroundColor: `${AZUL_MEDIO}33` }}
              />
            ) : null}
            <Icono size={34} weight="regular" style={{ color: AZUL_MEDIO }} className="shrink-0" />
            <p className="text-[clamp(0.72rem,1.4vmin,1rem)] font-medium leading-snug text-slate-700">
              {lineas[0]}
              <br />
              {lineas[1]}
            </p>
          </div>
        ))}

        {/*
          El lema, en cursiva y en el azul de la marca. Es el remate de la pieza
          aprobada; no dice nada operativo, y por eso va al final y sin peso.
        */}
        <p
          className="shrink-0 text-right text-[clamp(1rem,2.2vmin,1.6rem)] font-semibold italic leading-tight"
          style={{ color: AZUL_MEDIO }}
        >
          Juntos por
          <br />
          su salud
        </p>
      </footer>
    </main>
  )
}

/** Un titulo de columna: icono y palabra, en blanco sobre el azul profundo. */
function Encabezado({ Icono, texto }: { Icono: typeof User; texto: string }) {
  return (
    <div className="flex items-center gap-3 text-white">
      <Icono size={30} weight="fill" className="shrink-0 opacity-90" />
      <span className="truncate text-[clamp(0.9rem,1.9vmin,1.35rem)] font-semibold tracking-[0.01em]">{texto}</span>
    </div>
  )
}

/**
 * Una fila de la tabla.
 *
 * La destacada y las normales son EL MISMO componente con distinto tono, no dos
 * bloques parecidos: comparten la reja de columnas, y si estuvieran escritas
 * aparte bastaria tocar una para que la tabla se viera torcida desde la sala.
 */
function Fila({
  casilla,
  destacada = false,
  resaltada = false,
}: {
  casilla: CasillaPantalla
  destacada?: boolean
  resaltada?: boolean
}) {
  return (
    <div
      className={`grid shrink-0 ${COLUMNAS} items-center gap-6 rounded-[1.1rem] px-5 py-4 transition-all duration-500 ${
        resaltada ? 'motion-safe:animate-[pulse_1s_ease-in-out_2]' : ''
      }`}
      style={{ backgroundColor: destacada ? AZUL_MEDIO : '#FBFCFE' }}
    >
      <span
        data-cifras
        className="justify-self-start rounded-[0.9rem] px-6 py-2.5 text-[clamp(1.1rem,2.8vmin,2rem)] font-bold leading-none tracking-[-0.02em]"
        style={
          destacada
            ? { backgroundColor: AZUL_PROFUNDO, color: '#FFFFFF' }
            : { backgroundColor: AZUL_CLARO, color: AZUL_PROFUNDO }
        }
      >
        {casilla.codigo}
      </span>

      <div className="min-w-0">
        {/*
          El nombre puede venir vacio: una ventanilla de fila compartida no
          tiene doctor asignado. Se deja el hueco en lugar de escribir un guion,
          que obligaria al paciente a preguntarse que significa.
        */}
        <p
          className={`truncate text-[clamp(0.9rem,2vmin,1.4rem)] font-semibold leading-tight ${
            destacada ? 'text-white' : 'text-slate-800'
          }`}
        >
          {casilla.profesionalNombre ?? ''}
        </p>
        <p
          className={`truncate text-[clamp(0.72rem,1.5vmin,1.05rem)] font-medium leading-tight ${
            destacada ? 'text-white/80' : 'text-slate-500'
          }`}
        >
          {casilla.servicioNombre}
        </p>
      </div>

      <span
        className="flex min-w-0 items-center gap-2 justify-self-start rounded-full px-5 py-2.5"
        style={{ backgroundColor: destacada ? '#FFFFFF' : AZUL_CLARO }}
      >
        <MapPin size={22} weight="fill" className="shrink-0" style={{ color: AZUL_MEDIO }} />
        <span
          className="truncate text-[clamp(0.8rem,1.7vmin,1.2rem)] font-semibold leading-none"
          style={{ color: AZUL_PROFUNDO }}
        >
          {casilla.moduloNombre}
        </span>
      </span>
    </div>
  )
}

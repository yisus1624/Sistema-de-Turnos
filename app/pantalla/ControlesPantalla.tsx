'use client'

/**
 * Los mandos del televisor: estado de la conexion, sonido y pantalla completa.
 *
 * VIVEN AQUI PORQUE LOS DOS DISEÑOS TIENEN QUE LLEVAR LOS MISMOS. Estaban
 * escritos dentro de la cuadricula, asi que la cartelera nacio sin ellos: se
 * podia elegir ese diseño y quedarse sin forma de poner el televisor a pantalla
 * completa ni de silenciarlo, que son justo las dos cosas que se tocan al abrir
 * la sala por la mañana. Un mando que existe en un diseño y no en el otro no es
 * una diferencia de aspecto, es una funcion que desaparece.
 *
 * `IndicadorConexion` entra en el grupo por el mismo motivo: es lo unico que
 * avisa de que la pantalla dejo de recibir llamados. Sin el, una sala con la
 * conexion caida se ve exactamente igual que una sala sin pacientes.
 */

import { useEffect, useState } from 'react'
import { CornersIn, CornersOut, SpeakerHigh, SpeakerX, WifiSlash } from '@phosphor-icons/react/dist/ssr'
import { IndicadorConexion } from '@/components/ui/IndicadorConexion'
import type { EstadoConexionEnVivo } from '@/lib/hooks'
import type { AvisoDeSonido } from '@/lib/turnos/pantalla-tv'

/** Tras este tiempo reconectando, lo que se ve ya no es de fiar y se dice en grande. */
const MS_AVISO_SIN_CONEXION = 30_000

/** Si la conexion lleva mas de `MS_AVISO_SIN_CONEXION` en "reconectando". */
function useSinConexionProlongada(conexion: EstadoConexionEnVivo): boolean {
  const [prolongada, setProlongada] = useState(false)
  useEffect(() => {
    setProlongada(false)
    if (conexion !== 'reconectando') return
    const id = setTimeout(() => setProlongada(true), MS_AVISO_SIN_CONEXION)
    return () => clearTimeout(id)
  }, [conexion])
  return prolongada
}

type ControlesPantallaProps = {
  conexion: EstadoConexionEnVivo
  /**
   * El navegador no deja sonar y alguien deberia oir (ver `avisoDeSonido`).
   * Se muestra aqui, junto a los mandos, y no encima de los turnos.
   */
  avisoSonido: AvisoDeSonido
  activarSonido: () => void
  sonidoActivo: boolean
  alternarSonido: () => void
  pantallaCompleta: boolean
  alternarPantallaCompleta: () => void
  /**
   * `oscuro` para la cartelera, cuyos mandos van sobre una barra translucida
   * con la imagen de fondo por detras: ahi un boton gris claro se pierde.
   */
  tono?: 'claro' | 'oscuro'
}

export default function ControlesPantalla({
  conexion,
  avisoSonido,
  activarSonido,
  sonidoActivo,
  alternarSonido,
  pantallaCompleta,
  alternarPantallaCompleta,
  tono = 'claro',
}: ControlesPantallaProps) {
  /*
   * Los mandos son gris discreto A PROPOSITO, en los dos tonos.
   *
   * Esto lo mira una sala entera de pacientes y lo toca una persona, una vez al
   * dia. Que llamen la atencion iria en contra de lo unico que la pantalla
   * tiene que gritar, que es el turno. Se ven cuando se los busca y no antes.
   */
  const boton =
    tono === 'oscuro'
      ? 'bg-white/70 text-slate-600 hover:bg-white'
      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
  const sinConexionProlongada = useSinConexionProlongada(conexion)

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
      {sinConexionProlongada ? (
        /*
          Una franja arriba, de lado a lado: el semaforo pequeño no basta cuando
          la sala lleva rato sin recibir llamados y nadie mira los mandos.
        */
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-red-700 px-4 py-3 text-xl font-bold text-white"
        >
          <WifiSlash size="1.5rem" weight="bold" aria-hidden="true" />
          Sin conexión: los turnos pueden no estar al día
        </div>
      ) : null}
      {!sonidoActivo ? (
        /*
          El mudo del televisor queda recordado para siempre: sin esta marca,
          una sala silenciada se veia igual que una que suena.
        */
        <span
          role="status"
          className="flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-amber-100 px-4 text-sm font-bold text-amber-900"
        >
          <SpeakerX size="1.25rem" weight="bold" aria-hidden="true" />
          SALA EN SILENCIO
        </span>
      ) : null}
      {avisoSonido ? (
        /*
          Visible pero sin tapar nada: una pastilla ambar junto a los mandos.
          Sin ella, un televisor que se reinicio sin kiosco quedaba mudo y nadie
          se enteraba hasta que un paciente perdia su turno.
        */
        <button
          onClick={activarSonido}
          aria-label="Sonido desactivado: toca para activar"
          className="flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-amber-100 px-4 text-sm font-bold text-amber-900 transition-colors duration-[var(--suave)] hover:bg-amber-200"
        >
          <SpeakerX size="1.25rem" weight="bold" />
          {/* En pantallas angostas, corto: el texto largo empujaba los mandos fuera. */}
          <span className="hidden 2xl:inline">Sonido desactivado: toca para activar</span>
          <span className="2xl:hidden">Activar sonido</span>
        </button>
      ) : null}
      <IndicadorConexion estado={conexion} />
      <button
        onClick={alternarSonido}
        className={`grid h-11 w-11 place-items-center rounded-xl transition-colors duration-[var(--suave)] ${boton}`}
        aria-label={sonidoActivo ? 'Desactivar sonido' : 'Activar sonido'}
        title={sonidoActivo ? 'Desactivar sonido' : 'Activar sonido'}
      >
        {sonidoActivo ? <SpeakerHigh size="1.4rem" weight="bold" /> : <SpeakerX size="1.4rem" weight="bold" />}
      </button>
      <button
        onClick={alternarPantallaCompleta}
        className={`grid h-11 w-11 place-items-center rounded-xl transition-colors duration-[var(--suave)] ${boton}`}
        aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
        title={pantallaCompleta ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
      >
        {pantallaCompleta ? <CornersIn size="1.4rem" weight="bold" /> : <CornersOut size="1.4rem" weight="bold" />}
      </button>
    </div>
  )
}

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

import { CornersIn, CornersOut, SpeakerHigh, SpeakerX } from '@phosphor-icons/react/dist/ssr'
import { IndicadorConexion } from '@/components/ui/IndicadorConexion'
import type { EstadoConexionEnVivo } from '@/lib/hooks'

type ControlesPantallaProps = {
  conexion: EstadoConexionEnVivo
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

  return (
    <div className="flex items-center gap-3">
      <IndicadorConexion estado={conexion} />
      <button
        onClick={alternarSonido}
        className={`grid h-11 w-11 place-items-center rounded-xl transition-colors duration-[var(--suave)] ${boton}`}
        aria-label={sonidoActivo ? 'Desactivar sonido' : 'Activar sonido'}
        title={sonidoActivo ? 'Desactivar sonido' : 'Activar sonido'}
      >
        {sonidoActivo ? <SpeakerHigh size={22} weight="bold" /> : <SpeakerX size={22} weight="bold" />}
      </button>
      <button
        onClick={alternarPantallaCompleta}
        className={`grid h-11 w-11 place-items-center rounded-xl transition-colors duration-[var(--suave)] ${boton}`}
        aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
        title={pantallaCompleta ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
      >
        {pantallaCompleta ? <CornersIn size={22} weight="bold" /> : <CornersOut size={22} weight="bold" />}
      </button>
    </div>
  )
}

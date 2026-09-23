'use client'

/**
 * El sonido del televisor, SIN PORTADA.
 *
 * Antes la pantalla arrancaba en "Activar pantalla" y no mostraba turnos ni
 * abria el canal hasta que alguien hiciera clic: tras un apagon o un reinicio
 * del PC, la sala solo veia la portada. El clic existia por el audio, que el
 * navegador bloquea sin un gesto; pero para PINTAR turnos no hace falta
 * ninguno. Ahora la pantalla funciona desde el primer momento y esto solo se
 * ocupa del sonido:
 *
 *   - Si el navegador ya lo permite (kiosco con
 *     --autoplay-policy=no-user-gesture-required), suena sin que nadie toque.
 *   - Si no, `audio` queda en 'bloqueado' y la pantalla muestra un aviso
 *     pequeño; cualquier toque en la pantalla lo suelta.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  alCambiarElAudio,
  desbloquearAudio,
  estadoDelAudioDelNavegador,
  sonarCampana,
  type EstadoDelAudio,
} from '@/lib/turnos/anuncio'

/** Los eventos que el navegador acepta como gesto de una persona. */
const GESTOS = ['pointerdown', 'pointerup', 'click', 'keydown'] as const

interface Ajustes {
  /** Si esta sala NO esta en mudo. */
  sonidoActivo: boolean
  audioDelHospital: boolean
  volumen: number
}

export function useAudioDelTelevisor(ajustes: () => Ajustes) {
  // 'bloqueado' hasta mirar: en el servidor no hay navegador que consultar, y
  // suponer que suena seria esconder el aviso justo cuando hace falta.
  const [audio, setAudio] = useState<EstadoDelAudio>('bloqueado')

  useEffect(() => {
    setAudio(estadoDelAudioDelNavegador())
    return alCambiarElAudio(setAudio)
  }, [])

  // Cualquier toque o tecla es un gesto: se aprovecha para soltar el audio sin
  // obligar a nadie a encontrar el boton. En pantallas tactiles el navegador
  // solo cuenta como gesto el final del toque (`pointerup`, `click`), no el
  // principio: por eso van todos.
  useEffect(() => {
    if (audio !== 'bloqueado') return
    const soltar = () => void desbloquearAudio().then(setAudio)
    for (const tipo of GESTOS) window.addEventListener(tipo, soltar)
    return () => {
      for (const tipo of GESTOS) window.removeEventListener(tipo, soltar)
    }
  }, [audio])

  /**
   * El boton del aviso: suelta el audio, pone la pantalla completa y confirma
   * con UNA campanada al volumen configurado (antes sonaba a volumen 1, mas
   * fuerte que cualquier llamado). Si la sala esta en mudo, no suena.
   */
  const activarSonido = useCallback(async () => {
    // La pantalla completa se pide antes de cualquier espera: el navegador
    // solo la concede dentro del gesto.
    void document.documentElement.requestFullscreen?.().catch(() => {})
    const estado = await desbloquearAudio()
    setAudio(estado)

    const { sonidoActivo, audioDelHospital, volumen } = ajustes()
    if (estado === 'permitido' && sonidoActivo && audioDelHospital) sonarCampana(volumen)
  }, [ajustes])

  return { audio, activarSonido }
}

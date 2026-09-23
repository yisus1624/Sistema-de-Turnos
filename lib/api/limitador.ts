/**
 * Como mucho una carga cada `msMinimo`, y la ultima peticion nunca se pierde.
 *
 * Para las consultas pesadas que una pantalla repite con cada evento en vivo:
 * la primera va en el acto; las que llegan durante el intervalo se juntan en
 * UNA al final de ese intervalo. A diferencia de esperar a que la rafaga se
 * calme, con eventos sin parar sigue cargando cada intervalo: la pantalla
 * nunca se queda esperando a un silencio que en hora pico no llega.
 *
 * Sin React ni temporizadores fijos: se prueba en Node con reloj de mentira.
 */
import { programadorReal, type Programador } from '@/lib/programador'

export interface Limitador {
  pedir: () => void
  cancelar: () => void
}

export function crearLimitador(
  msMinimo: number,
  cargar: () => void,
  tiempo: { programar: Programador; reloj: () => number } = { programar: programadorReal, reloj: Date.now },
): Limitador {
  let ultimaCarga = Number.NEGATIVE_INFINITY
  let soltarPendiente: (() => void) | null = null

  const ejecutar = () => {
    soltarPendiente = null
    ultimaCarga = tiempo.reloj()
    cargar()
  }

  const pedir = () => {
    if (soltarPendiente) return
    const espera = ultimaCarga + msMinimo - tiempo.reloj()
    if (espera <= 0) ejecutar()
    else soltarPendiente = tiempo.programar(ejecutar, espera)
  }

  const cancelar = () => {
    soltarPendiente?.()
    soltarPendiente = null
  }

  return { pedir, cancelar }
}

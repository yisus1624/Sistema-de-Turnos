'use client'

import { useEffect, useState } from 'react'
import { seNombraAlPaciente } from '@/lib/turnos/nombre-abreviado'
import { pedir } from './cliente'

/**
 * Si la sala usa la cartelera CON NOMBRE, para las pantallas con sesion
 * (admisiones, simulacion): con ella el codigo de turno no se muestra en
 * ninguna parte, porque el paciente no lo conoce.
 *
 * Lo lee de la misma ruta que el televisor (y de la del mundo de la sesion:
 * la cuenta de demostracion ve la configuracion de su hospital de prueba). Si
 * no responde, `false`: la cartelera de turno es la de partida.
 *
 * El consultorio NO lo usa: su enlace solo viaja a `/api/consultorio`, que ya
 * trae el dato en su propia respuesta.
 */
export function useSalaConNombres(): boolean {
  const [conNombres, setConNombres] = useState(false)

  useEffect(() => {
    let vigente = true
    pedir<{ configuracion?: { disenoPantalla?: string } }>('/api/turnos/pantalla')
      .then((estado) => {
        if (vigente) setConNombres(seNombraAlPaciente(estado.configuracion?.disenoPantalla))
      })
      .catch(() => {})
    return () => {
      vigente = false
    }
  }, [])

  return conNombres
}

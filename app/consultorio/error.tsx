'use client'

/**
 * Limite de errores del consultorio: se recupera solo, y ademas ofrece
 * reintentar ya.
 *
 * El doctor pasa la jornada con esta pantalla abierta y no siempre la esta
 * mirando: si se rompe entre paciente y paciente no puede quedarse en blanco
 * hasta que alguien se de cuenta. Vuelve a pintarse sola con espera creciente
 * (ver `lib/api/recuperacion.ts`), sin recargar: el doctor esta delante y, si
 * hiciera falta, el boton vuelve a pedir la pantalla entera al servidor.
 */
import { useEffect } from 'react'
import type { ErrorInfo } from 'next/error'
import { Button } from '@/components/ui/Button'
import PantallaDeError from '@/components/ui/PantallaDeError'
import { crearRachaDeFallos, programarRecuperacion } from '@/lib/api/recuperacion'

// Fuera del componente: React vuelve a montar este aviso con cada reintento
// que falla, y la racha tiene que seguir contando (ver `RachaDeFallos`).
const racha = crearRachaDeFallos()

export default function ErrorDelConsultorio({ reset, retry }: ErrorInfo) {
  useEffect(() => programarRecuperacion({ racha, reintentar: reset }), [reset])

  return (
    <PantallaDeError
      titulo="Se está recuperando tu consultorio"
      descripcion="Ocurrió un error al mostrar la pantalla y se está cargando de nuevo sola. Tus pacientes no se pierden: siguen en la fila."
    >
      <Button type="button" onClick={retry}>
        Reintentar ahora
      </Button>
    </PantallaDeError>
  )
}

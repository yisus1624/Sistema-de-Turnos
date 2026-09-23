'use client'

import { CONFIGURACION_INICIAL } from '@/lib/turnos/configuracion-inicial'
import type { CasillaPantalla } from '@/lib/turnos/types'
import Cartelera from '../Cartelera'
import ControlesPantalla from '../ControlesPantalla'
import DisenoCuadricula from '../DisenoCuadricula'

const CONFIGURACION = { ...CONFIGURACION_INICIAL, mensajePie: 'Mensaje de prueba al pie de la pantalla' }

/** El nombre largo con el que se comprueba que el medico pasa a dos lineas sin cortarse. */
const MEDICO_LARGO = 'CARLOS RAMON DE LEON CASTILLO'

/** Casillas inventadas: casi todas de consulta externa y algunas de odontologia, como en el hospital. */
function casillasSimuladas(cantidad: number, medicoLargo: boolean): CasillaPantalla[] {
  const base = Date.UTC(2026, 8, 22, 14, 0)
  return Array.from({ length: cantidad }, (_, i) => {
    const odontologia = i >= Math.ceil(cantidad * 0.8)
    return {
      moduloId: `muestra-${i}`,
      moduloNombre: `CONS ${String(i + 1).padStart(2, '0')} - ${odontologia ? 'ODONTOLOGIA' : 'CONSULTA EXTERNA'}`,
      servicioId: odontologia ? 'odontologia' : 'consulta',
      servicioNombre: odontologia ? 'Odontologia' : 'Consulta externa',
      profesionalNombre: medicoLargo && i % 2 === 0 ? MEDICO_LARGO : `DRA. ANA RUIZ ${i + 1}`,
      codigo: i % 5 === 4 ? null : `${odontologia ? 'O' : 'C'}-${String(10 + i).padStart(3, '0')}`,
      horaLlamado: i % 5 === 4 ? null : new Date(base + i * 60_000).toISOString(),
      vecesLlamado: 1,
    }
  })
}

type MuestraProps = {
  cantidad: number
  diseno: 'cuadricula' | 'cartelera'
  medicoLargo: boolean
  /** Resalta el ultimo llamado, como si acabara de sonar. */
  resaltar: boolean
}

export default function MuestraCliente({ cantidad, diseno, medicoLargo, resaltar }: MuestraProps) {
  const casillas = casillasSimuladas(cantidad, medicoLargo)
  const resaltado = resaltar ? (casillas.findLast((casilla) => casilla.codigo)?.moduloId ?? null) : null
  const controles = (
    <ControlesPantalla
      conexion="en-vivo"
      avisoSonido="tocar_para_activar"
      activarSonido={() => {}}
      sonidoActivo
      alternarSonido={() => {}}
      pantallaCompleta={false}
      alternarPantallaCompleta={() => {}}
      tono={diseno === 'cartelera' ? 'oscuro' : 'claro'}
    />
  )

  // Marcada a la vista: que nadie la confunda con la pantalla real de la sala.
  const marca = (
    <p className="fixed left-1/2 top-2 z-50 -translate-x-1/2 rounded-full bg-red-600 px-4 py-1 text-sm font-bold text-white">
      MUESTRA CON DATOS SIMULADOS · solo desarrollo
    </p>
  )

  if (diseno === 'cartelera') {
    return (
      <>
        {marca}
        <Cartelera
          casillas={casillas}
          configuracion={CONFIGURACION}
          resaltado={resaltado}
          hora="08:30 a. m."
          controles={controles}
          mensajeSinLlamados="Aun no se ha llamado ningun turno."
        />
      </>
    )
  }
  return (
    <>
      {marca}
      <DisenoCuadricula
        casillas={casillas}
        configuracion={CONFIGURACION}
        resaltado={resaltado}
        mensajeVacio="Aun no hay consultorios ni ventanillas activos."
        controles={controles}
      />
    </>
  )
}

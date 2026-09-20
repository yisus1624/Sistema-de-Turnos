'use client'

/**
 * Purga de datos de pacientes: quitarle el nombre y el documento a los dias
 * viejos.
 *
 * VIVE EN SU PROPIO DIALOGO Y NO EN LA CARGA DE LA AGENDA. La carga del
 * hospital se hace a media mañana, con pacientes ya presentados y turnos en la
 * mano; encadenarle un borrado es hacer lo mas peligroso del sistema en el peor
 * momento posible, y sin que nadie lo haya pedido esa vez.
 *
 * TODO LO DE ESTA PANTALLA EXISTE PARA QUE NO SE PURGUE DE MAS. La cuenta sale
 * ANTES de la confirmacion, la fecha se teclea a mano, y el resumen dice a
 * cuantos dias y a cuantas citas alcanza. No hay deshacer: lo unico que queda
 * despues es el apunte del registro de actividad.
 */

import { useCallback, useEffect, useState } from 'react'
import { Warning } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { Campo, Entrada } from '@/components/admin/Campos'
import { toast } from '@/components/ui/toast'
import { mensajeDeError, pedir } from '@/lib/api/cliente'

interface ResumenPurga {
  limite: string
  dias: number
  citas: number
  turnos: number
}

export default function PurgaDatosModal({
  abierto,
  onCerrar,
}: {
  abierto: boolean
  onCerrar: () => void
}) {
  const [limite, setLimite] = useState('')
  const [resumen, setResumen] = useState<ResumenPurga | null>(null)
  const [contando, setContando] = useState(false)
  const [confirmacion, setConfirmacion] = useState('')
  const [purgando, setPurgando] = useState(false)

  /**
   * Cuenta lo que se tocaria. No escribe nada.
   *
   * Sin fecha, la calcula el servidor: la ventana de retencion es una regla del
   * dominio y no algo que cada pantalla deba volver a calcular por su cuenta.
   */
  const contar = useCallback(async (fecha?: string) => {
    setContando(true)
    try {
      const datos = await pedir<ResumenPurga>(
        `/api/turnos/citas/purga${fecha ? `?limite=${fecha}` : ''}`,
      )
      setResumen(datos)
      setLimite(datos.limite)
    } catch (error) {
      setResumen(null)
      toast.error('No se pudo calcular la purga', mensajeDeError(error))
    } finally {
      setContando(false)
    }
  }, [])

  useEffect(() => {
    if (!abierto) return
    setConfirmacion('')
    setResumen(null)
    contar()
  }, [abierto, contar])

  async function purgar() {
    if (!resumen) return
    setPurgando(true)
    try {
      const hecho = await pedir<ResumenPurga>('/api/turnos/citas/purga', {
        method: 'POST',
        body: JSON.stringify({ limite: resumen.limite, confirmacion }),
      })
      toast.success(
        'Datos de pacientes anonimizados',
        `${hecho.citas} cita(s) y ${hecho.turnos} turno(s) de ${hecho.dias} dia(s) anteriores al ${hecho.limite}.`,
      )
      onCerrar()
    } catch (error) {
      toast.error('No se pudo purgar', mensajeDeError(error))
    } finally {
      setPurgando(false)
    }
  }

  const nadaQueHacer = resumen !== null && resumen.citas === 0 && resumen.turnos === 0
  const puedePurgar =
    !!resumen && !nadaQueHacer && !contando && confirmacion.trim() === resumen.limite

  return (
    <Modal
      open={abierto}
      onClose={onCerrar}
      title="Anonimizar datos de pacientes"
      description="Los dias anteriores al limite pierden el nombre y el documento del paciente. Conservan la fecha, la hora, el doctor, el servicio y el estado, que es lo que sostiene las estadisticas y las jornadas."
    >
      <div className="space-y-4">
        <Campo
          etiqueta="Anonimizar lo anterior a"
          ayuda="Ese dia no se toca; se anonimiza lo de antes. Nunca hoy ni fechas futuras."
          className="max-w-[220px]"
        >
          <Entrada
            type="date"
            value={limite}
            onChange={(e) => {
              setLimite(e.target.value)
              setConfirmacion('')
              if (e.target.value) contar(e.target.value)
            }}
          />
        </Campo>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          {contando ? (
            <p className="text-sm font-semibold text-slate-400">Contando…</p>
          ) : !resumen ? (
            <p className="text-sm text-slate-500">Elige una fecha para ver a cuanto alcanza.</p>
          ) : nadaQueHacer ? (
            <p className="text-sm font-bold text-slate-600">
              No hay nada que anonimizar antes del {resumen.limite}.
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold text-brand-950">
                {resumen.dias} dia(s) · {resumen.citas} cita(s) · {resumen.turnos} turno(s)
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                <strong className="font-semibold">Se borran:</strong> nombre, documento, tipo de
                documento, procedimiento y CUPS.
                <br />
                <strong className="font-semibold">Se conservan:</strong> fecha, hora, doctor, servicio
                y estado de cada cita.
              </p>
            </>
          )}
        </div>

        {!nadaQueHacer && resumen ? (
          <>
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <Warning size={20} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-sm leading-6 text-amber-900">
                Esto no se puede deshacer. Los datos del paciente estan en SaludPlus; aqui no
                vuelven.
              </p>
            </div>

            <Campo
              etiqueta={`Escribe ${resumen.limite} para confirmar`}
              className="max-w-[220px]"
            >
              <Entrada
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                placeholder={resumen.limite}
                autoComplete="off"
              />
            </Campo>
          </>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={purgar} loading={purgando} disabled={!puedePurgar}>
            Anonimizar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

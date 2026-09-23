'use client'

/**
 * Registro de llegada en admisiones.
 *
 * Es el paso que convierte una cita de la agenda en un turno en espera: el
 * paciente llega, da su documento, el funcionario confirma que se presento y
 * desde ese momento aparece en la fila de su profesional.
 *
 * El documento y el nombre completo solo se ven aqui, en una pantalla con
 * sesion: hacia la pantalla de la sala de espera no viaja ningun dato del
 * paciente, ni siquiera abreviado.
 *
 * Por eso esta pantalla termina en un COMPROBANTE grande con el turno, el
 * consultorio y el doctor: es lo que el funcionario le dicta al paciente, y
 * es todo lo que este necesita para reconocerse despues en la pantalla, donde
 * solo va a ver su numero de turno.
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, CheckCircle, DoorOpen, Stethoscope, UserFocus, WifiSlash } from '@phosphor-icons/react/dist/ssr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Loader'
import { toast } from '@/components/ui/toast'
import { useCargaConReintento, useUltimaPeticion, useValorConRetraso } from '@/lib/hooks'
import { esReintentable, type ResultadoDeCarga } from '@/lib/api/reintento'
// El cliente COMPARTIDO, no una copia local. Esta pantalla tenia la suya, y por
// eso se quedaba fuera del manejo de sesion caducada: el funcionario seguia
// viendo la busqueda de siempre y creia haber registrado llegadas que la API
// estaba rechazando con un 401. Justo aqui es donde peor duele.
import { horaCorta, mensajeDeError, pedir } from '@/lib/api/cliente'
import type { Cita, ComprobanteLlegada, Turno } from '@/lib/turnos/types'

/** Digitos minimos antes de consultar: menos que esto da media EPS. */
const MINIMO_DIGITOS = 4

/** "jueves, 11 de septiembre" — para que no haya duda de que no es hoy. */
function fechaLarga(iso: string) {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

/**
 * Lo que hay que decirle al paciente si su turno ya se cerro. Sin esto, "Ver
 * comprobante" dictaba un turno que ya no lo van a llamar.
 */
const AVISO_TURNO_CERRADO: Partial<Record<ComprobanteLlegada['estadoTurno'], string>> = {
  ATENDIDO: 'Este paciente ya fue atendido: su turno esta cerrado.',
  AUSENTE: 'A este paciente se le marco ausente cuando lo llamaron. Agendale una cita nueva.',
  CANCELADO: 'Este turno fue cancelado. Agendale una cita nueva.',
}

const etiquetaEstado: Record<Cita['estado'], { texto: string; tono: 'blue' | 'green' | 'amber' | 'red' }> = {
  PROGRAMADA: { texto: 'Programada', tono: 'blue' },
  PRESENTADO: { texto: 'Ya registro llegada', tono: 'amber' },
  ATENDIDA: { texto: 'Atendida', tono: 'green' },
  CANCELADA: { texto: 'Cancelada', tono: 'red' },
}

export default function AdmisionesClient() {
  const [documento, setDocumento] = useState('')
  const [citas, setCitas] = useState<Cita[] | null>(null)
  // Citas del paciente en otros dias. No se les registra la llegada; estan
  // para poder decirle "su cita es el jueves" en vez de "no tiene citas".
  const [otras, setOtras] = useState<Cita[]>([])
  const [buscando, setBuscando] = useState(false)
  const [registrando, setRegistrando] = useState<string | null>(null)
  const [comprobante, setComprobante] = useState<ComprobanteLlegada | null>(null)

  // Si la ultima busqueda fallo. Mientras tanto no se muestra ninguna cita:
  // antes quedaban a la vista las del paciente ANTERIOR, con su boton de
  // "Registrar llegada", bajo el documento del nuevo.
  // Y si se reintenta sola: un 400 o un 403 no, y decirlo seria mentirle.
  const [falloBusqueda, setFalloBusqueda] = useState<{ mensaje: string; reintentable: boolean } | null>(null)

  // Busca sola al dejar de escribir: no hay boton que presionar.
  const documentoDiferido = useValorConRetraso(documento, 400)
  // La ultima busqueda gana: la respuesta de un documento que el operador ya
  // reemplazo al seguir escribiendo se descarta.
  const busquedas = useUltimaPeticion()

  const buscar = useCallback(async (): Promise<ResultadoDeCarga> => {
    const buscado = documentoDiferido.trim()
    const peticion = busquedas.iniciar()
    setCitas(null)
    setOtras([])
    setFalloBusqueda(null)
    if (buscado.length < MINIMO_DIGITOS) {
      setBuscando(false)
      return
    }
    setBuscando(true)
    setComprobante(null)
    try {
      // Por POST y en el cuerpo: en la URL, la cedula quedaba en el log del servidor.
      const encontradas = await pedir<{ citas: Cita[]; otras: Cita[] }>('/api/turnos/citas', {
        method: 'POST',
        body: JSON.stringify({ documento: buscado }),
        signal: peticion.signal,
      })
      if (!peticion.esVigente()) return 'reemplazada'
      setCitas(encontradas.citas)
      setOtras(encontradas.otras ?? [])
    } catch (error) {
      if (!peticion.esVigente()) return 'reemplazada'
      setFalloBusqueda({
        mensaje: mensajeDeError(error) ?? 'No hubo respuesta del servidor.',
        reintentable: esReintentable(error),
      })
      // Se relanza para que `useCargaConReintento` lo reintente solo si el
      // fallo es pasajero (sin red, 429, 500).
      throw error
    } finally {
      if (peticion.esVigente()) setBuscando(false)
    }
  }, [documentoDiferido, busquedas])

  // Con reintento: un corte de red no deja al operador esperando a que vuelva
  // a escribir el mismo documento, que antes no buscaba de nuevo.
  const reintentarBusqueda = useCargaConReintento(buscar)

  useEffect(() => {
    void reintentarBusqueda()
  }, [buscar, reintentarBusqueda])

  /**
   * Registra la llegada, o recupera el comprobante si ya estaba registrada.
   *
   * El servidor es idempotente: si la respuesta de la primera vez se perdio por
   * la red, el reintento devuelve el MISMO turno (`yaRegistrada`) en vez de un
   * error. Antes el funcionario leia "esta cita ya registro la llegada" y el
   * turno y el consultorio que tenia que dictarle al paciente no aparecian
   * nunca. El mismo camino sirve para volver a ver el comprobante.
   */
  async function registrarLlegada(cita: Cita) {
    setRegistrando(cita.id)
    try {
      const { comprobante: entregado, yaRegistrada } = await pedir<{
        turno: Turno
        comprobante: ComprobanteLlegada
        yaRegistrada?: boolean
      }>('/api/turnos/citas/llegada', {
        method: 'POST',
        body: JSON.stringify({ citaId: cita.id }),
      })
      setComprobante(entregado)
      setCitas((previas) =>
        previas?.map((c) =>
          c.id === cita.id ? { ...c, estado: 'PRESENTADO', codigoTurno: entregado.codigo } : c,
        ) ?? null,
      )
      if (yaRegistrada) toast.info('La llegada ya estaba registrada', `Su turno es el ${entregado.codigo}.`)
      else toast.success('Llegada registrada', `Turno ${entregado.codigo} para ${cita.nombrePaciente}.`)
    } catch (error) {
      toast.error('No se pudo registrar la llegada', error instanceof Error ? error.message : undefined)
    } finally {
      setRegistrando(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Buscar al paciente</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-slate-700">Numero de documento</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={20}
              autoComplete="off"
              autoFocus
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              placeholder="Cedula del paciente"
              className="h-12 w-full rounded-xl border border-slate-200 px-4 text-base font-semibold text-brand-950 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
            />
            <span className="mt-1.5 block text-xs font-medium text-slate-400">
              Las citas del dia aparecen solas al escribir el documento.
            </span>
          </label>
        </CardContent>
      </Card>

      {comprobante && AVISO_TURNO_CERRADO[comprobante.estadoTurno] ? (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5 text-center">
          <p className="text-sm font-bold uppercase tracking-wide text-amber-700">Turno {comprobante.codigo}</p>
          <p className="mt-1 text-lg font-semibold text-amber-900">{AVISO_TURNO_CERRADO[comprobante.estadoTurno]}</p>
        </div>
      ) : comprobante ? (
        <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50">
          <div className="px-6 pt-5 text-center">
            <p className="text-sm font-bold uppercase tracking-wide text-emerald-700">Turno asignado</p>
            <p className="mt-1 text-6xl font-semibold tracking-[-0.03em] text-emerald-900">
              {comprobante.codigo}
            </p>
            {comprobante.nombrePaciente ? (
              <p className="mt-1 text-sm font-bold text-emerald-800">{comprobante.nombrePaciente}</p>
            ) : null}
          </div>

          {/* Consultorio y doctor: es lo que hay que decirle en voz alta, asi
              que va en bloques grandes y separados, no en una linea de texto
              corrido que el funcionario tenga que descifrar con el paciente
              enfrente. */}
          <div className="mt-4 grid gap-px bg-emerald-200 sm:grid-cols-2">
            <div className="bg-white px-5 py-4">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                <DoorOpen size={16} weight="bold" />
                Consultorio
              </p>
              <p className="mt-1 text-xl font-semibold leading-tight text-brand-950">
                {comprobante.moduloNombre ?? 'Se le indicara en la pantalla'}
              </p>
            </div>
            <div className="bg-white px-5 py-4">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                <Stethoscope size={16} weight="bold" />
                Lo atiende
              </p>
              <p className="mt-1 text-xl font-semibold leading-tight text-brand-950">
                {comprobante.profesionalNombre ?? comprobante.servicioNombre}
              </p>
            </div>
          </div>

          <p className="bg-emerald-100 px-6 py-3 text-center text-sm font-semibold leading-6 text-emerald-900">
            Digale al paciente que espere en la sala. En la pantalla va a aparecer{' '}
            <strong className="font-semibold">solo su turno {comprobante.codigo}</strong> y el consultorio al
            que debe entrar; su nombre no se muestra ni se dice en voz alta.
          </p>
        </div>
      ) : null}

      {buscando ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <ul className="space-y-3" aria-busy="true" aria-label="Buscando citas">
              {Array.from({ length: 2 }).map((_, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-5 w-48 max-w-full" />
                    <Skeleton className="mt-2 h-3 w-56 max-w-full" />
                  </div>
                  <Skeleton className="h-9 w-36 shrink-0" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : falloBusqueda ? (
        <EmptyState
          icon={WifiSlash}
          title="No se pudo buscar"
          description={
            falloBusqueda.reintentable
              ? `${falloBusqueda.mensaje} La busqueda se reintenta sola.`
              : falloBusqueda.mensaje
          }
          action={
            <Button variant="secondary" onClick={() => void reintentarBusqueda()}>
              <ArrowClockwise size={17} weight="bold" />
              Reintentar
            </Button>
          }
        />
      ) : citas === null ? (
        <EmptyState
          icon={UserFocus}
          title="Busca por documento"
          description="Escribe el numero de documento del paciente para ver sus citas de hoy y registrar su llegada."
        />
      ) : citas.length === 0 ? (
        <EmptyState
          icon={UserFocus}
          title="No tiene cita para hoy"
          description={
            otras.length > 0
              ? 'Este paciente si tiene cita, pero en otra fecha. Mirala abajo y confirmasela; hoy no se le puede registrar la llegada.'
              : 'Verifica el numero. Si el paciente no tiene cita, atiendelo por la fila de ventanilla.'
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Citas de hoy ({citas.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {citas.map((cita) => {
                const estado = etiquetaEstado[cita.estado]
                const puedeRegistrar = cita.estado === 'PROGRAMADA'
                // Ya llego: se le puede volver a dictar su turno sin crear otro.
                const puedeVerComprobante = cita.estado === 'PRESENTADO'

                return (
                  <li
                    key={cita.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-brand-950">{cita.nombrePaciente}</p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {horaCorta(cita.horaCita)} · documento {cita.documentoPaciente}
                        {cita.codigoTurno ? (
                          <>
                            {' · turno '}
                            <strong className="font-semibold text-brand-950">{cita.codigoTurno}</strong>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone={estado.tono}>{estado.texto}</Badge>
                      {puedeRegistrar ? (
                        <Button
                          size="sm"
                          loading={registrando === cita.id}
                          onClick={() => registrarLlegada(cita)}
                        >
                          <CheckCircle size={17} weight="bold" />
                          Registrar llegada
                        </Button>
                      ) : null}
                      {puedeVerComprobante ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={registrando === cita.id}
                          onClick={() => registrarLlegada(cita)}
                        >
                          Ver comprobante
                        </Button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/*
        Citas de OTROS dias: sin boton, a proposito.

        Antes la busqueda devolvia las citas de cualquier fecha y la lista se
        mostraba solo con la hora, asi que una cita de la semana entrante se
        veia igual que una de hoy y se le podia registrar la llegada: el
        paciente entraba a la fila de un dia que no era el suyo y quemaba la
        cita. Aqui salen aparte, con la fecha bien visible, para poder decirle
        cuando le toca.
      */}
      {otras.length > 0 ? (
        <Card padded={false}>
          <CardHeader>
            <CardTitle>Tiene cita en otra fecha ({otras.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm leading-6 text-slate-600">
              Estas citas <strong className="font-semibold">no son de hoy</strong>, asi que no se les registra
              la llegada. Confirmale al paciente el dia y la hora.
            </p>
            <ul className="space-y-2">
              {otras.map((cita) => (
                <li
                  key={cita.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-amber-950">{cita.nombrePaciente}</p>
                    <p className="mt-0.5 text-sm font-semibold text-amber-800">
                      {fechaLarga(cita.horaCita)} · {horaCorta(cita.horaCita)}
                    </p>
                  </div>
                  <Badge tone="amber">Otra fecha</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

'use client'

/**
 * Registro de actividades importantes (requerimiento seccion 17).
 *
 * Aqui se lee QUIEN decidio cada cosa. El turno guarda su propio recorrido
 * (horas, veces llamado, quien lo cerro), pero eso son campos de una fila que
 * mañana se sobrescribe; el registro es lo unico que conserva la decision tal
 * como se tomo, con la persona y el momento.
 *
 * Los llamados tambien se apuntan, aunque sean muchos: el doctor llama desde un
 * enlace temporal, sin usuario ni contrasena, asi que si su llamado no queda
 * escrito no queda nada de lo que pasa en el consultorio. El selector de tipo
 * de arriba es justo para eso: acotar la lista a lo que se esta revisando.
 */

import { useCallback, useEffect, useState } from 'react'
import { Broom, CalendarBlank, ShieldCheck } from '@phosphor-icons/react/dist/ssr'
import PurgaDatosModal from '@/components/seguridad/PurgaDatosModal'
import { Paginacion, usePaginacion } from '@/components/ui/Paginacion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { Campo, Entrada, Seleccion, Tabla, TablaSkeleton } from '@/components/admin/Campos'
import { toast } from '@/components/ui/toast'
import { hoyEnColombia, mensajeDeError, pedir } from '@/lib/api/cliente'
import { resumirDetalle } from '@/lib/seguridad/detalle'
import type { EventoSeguridad } from '@/lib/seguridad/tipos'

const COLUMNAS = ['Cuando', 'Que paso', 'Quien', 'Sobre', 'Detalle']

/** Nombre legible de cada tipo de evento. Uno desconocido se muestra tal cual. */
const ETIQUETAS: Record<string, string> = {
  INICIO_SESION: 'Inicio de sesion',
  USUARIO_CREADO: 'Cuenta creada',
  USUARIO_ACTUALIZADO: 'Cuenta modificada',
  USUARIO_RENOMBRADO: 'Nombre de usuario cambiado',
  USUARIO_CONTRASENA_CAMBIADA: 'Contrasena cambiada',
  ACCESO_PROFESIONAL: 'Acceso del doctor',
  ACCESO_PROFESIONAL_GENERADO: 'Enlace de consultorio generado',
  ACCESO_PROFESIONAL_REVOCADO: 'Enlace de consultorio revocado',
  CITA_CREADA: 'Cita agendada',
  CITA_CANCELADA: 'Cita cancelada',
  CITA_REPROGRAMADA: 'Cita reprogramada',
  LLEGADA_REGISTRADA: 'Llegada registrada',
  TURNO_GENERADO: 'Turno de ventanilla entregado',
  TURNO_LLAMADO: 'Turno llamado',
  TURNO_REPETIDO: 'Llamado repetido',
  TURNO_ATENDIDO: 'Turno cerrado como atendido',
  TURNO_AUSENTE: 'Paciente dado por ausente',
  TURNO_RETROCEDIDO: 'Retroceso al turno anterior',
  CONFIGURACION_ACTUALIZADA: 'Configuracion del sistema',
  SIMULACION_REINICIO_DEL_DIA: 'Reinicio del dia (simulacion)',
  // Estos tres se guardan en minusculas porque nacieron despues. El nombre
  // guardado no se toca —cambiarlo dejaria ilegibles los registros que ya
  // estan— pero si su etiqueta, que es lo que se lee en la pantalla. Los tipos
  // salen de `lib/seguridad/eventos.ts`, que explica por que conviven dos
  // formas de escribirlos.
  'citas.importadas': 'Agenda del hospital cargada',
  'citas.datos.purgados': 'Datos de pacientes anonimizados',
  'profesionales.jornadas.recalculadas': 'Jornadas de los doctores recalculadas',
  SERVICIO_CREADO: 'Servicio creado',
  SERVICIO_ACTUALIZADO: 'Servicio modificado',
  SERVICIO_ELIMINADO: 'Servicio eliminado',
  MODULO_CREADO: 'Consultorio creado',
  MODULO_ACTUALIZADO: 'Consultorio modificado',
  PROFESIONAL_CREADO: 'Doctor registrado',
  PROFESIONAL_ACTUALIZADO: 'Doctor modificado',
}

function cuando(iso: string) {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

export default function RegistroActividadClient({ esAdministrador }: { esAdministrador: boolean }) {
  const [eventos, setEventos] = useState<EventoSeguridad[]>([])
  const [tipos, setTipos] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [tipo, setTipo] = useState('')
  const [soloFallidos, setSoloFallidos] = useState(false)
  const [purgaAbierta, setPurgaAbierta] = useState(false)

  /**
   * El dia que se esta mirando. Arranca en HOY, que es lo que se consulta el
   * 90% de las veces; vacio significa "todos los dias".
   */
  const [fecha, setFecha] = useState(hoyEnColombia)

  /**
   * Se consulta al SERVIDOR con los filtros puestos, no se filtra aqui.
   *
   * Antes se pedian los ultimos 500 eventos y se recortaban en el navegador:
   * con eso no habia forma de preguntar por un dia concreto, que es justo como
   * se usa un registro de auditoria —alguien reclama algo que paso el martes, y
   * hay que poder ir al martes— y ademas, en cuanto el hospital lleva unos
   * meses funcionando, 500 eventos no alcanzan ni para una semana.
   */
  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const parametros = new URLSearchParams({ limite: '500' })
      if (fecha) parametros.set('fecha', fecha)
      if (tipo) parametros.set('tipo', tipo)
      if (soloFallidos) parametros.set('fallidos', '1')

      const datos = await pedir<{ eventos: EventoSeguridad[]; tipos: string[] }>(
        `/api/seguridad/eventos?${parametros}`,
      )
      setEventos(datos.eventos)
      setTipos(datos.tipos)
    } catch (error) {
      toast.error('No se pudo cargar el registro', mensajeDeError(error))
    } finally {
      setCargando(false)
    }
  }, [fecha, tipo, soloFallidos])

  useEffect(() => {
    cargar()
  }, [cargar])

  const visibles = eventos
  // Hasta 500 eventos por consulta: de a una pagina, no una tabla sin fin.
  const pagina = usePaginacion(visibles, [fecha, tipo, soloFallidos])

  return (
    <>
    <Card padded={false}>
      <CardHeader>
        <CardTitle>
          {fecha ? `Actividad del ${fecha}` : 'Toda la actividad'} ({visibles.length})
        </CardTitle>
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Dia" className="w-44">
            <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setFecha(fecha ? '' : hoyEnColombia())}
            title={
              fecha
                ? 'Quitar el dia y ver la actividad de todos los dias'
                : 'Volver a la actividad de hoy'
            }
          >
            <CalendarBlank size={16} weight="bold" />
            {fecha ? 'Ver todos los dias' : 'Solo hoy'}
          </Button>
          <Campo etiqueta="Tipo" className="w-56">
            <Seleccion value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETAS[t] ?? t}
                </option>
              ))}
            </Seleccion>
          </Campo>
          <Button
            variant={soloFallidos ? 'danger' : 'secondary'}
            size="sm"
            onClick={() => setSoloFallidos((v) => !v)}
          >
            {soloFallidos ? 'Viendo solo fallidos' : 'Ver solo fallidos'}
          </Button>
          <Button variant="secondary" size="sm" onClick={cargar}>
            Actualizar
          </Button>
          {/*
            Aqui y no junto a la carga de la agenda: es lo unico irreversible
            del sistema y no puede ser un efecto secundario del trabajo diario.
          */}
          {esAdministrador ? (
            <Button variant="secondary" size="sm" onClick={() => setPurgaAbierta(true)}>
              <Broom size={16} weight="bold" />
              Anonimizar datos viejos
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent padded={false}>
        {cargando ? (
          <TablaSkeleton columnas={COLUMNAS} />
        ) : visibles.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={ShieldCheck}
              title="Sin actividad registrada"
              description="Aqui van a aparecer los inicios de sesion, los cambios de cuentas y el recorrido de las citas y los turnos."
            />
          </div>
        ) : (
          <>
            <p className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs leading-5 text-slate-500">
              El registro se guarda en la base de datos y no se borra al reiniciar el sistema. Los
              llamados de turno no se apuntan aqui porque ese recorrido queda entero en el turno: quien
              llamo, a que hora, cuantas veces y quien lo cerro.
            </p>
            <Tabla columnas={COLUMNAS}>
              {pagina.visibles.map((evento, i) => (
                <tr key={`${evento.fecha}-${i}`} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-slate-600">
                    {cuando(evento.fecha)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={evento.exito ? 'green' : 'red'}>{evento.exito ? 'OK' : 'Fallo'}</Badge>
                      <span className="font-bold text-brand-950">{ETIQUETAS[evento.tipo] ?? evento.tipo}</span>
                    </div>
                  </td>
                  {/*
                    EL NOMBRE, no el identificador interno. Un cuid no le dice
                    nada a quien revisa el registro, y es lo unico que se
                    guardaba: "quien hizo esto" se contestaba con
                    `clx3f9a2b...`. El nombre queda copiado en el apunte, asi
                    que sigue leyendose aunque despues se cambien las
                    credenciales o se de de baja la cuenta.
                  */}
                  <td className="px-4 py-3">
                    {evento.usuarioNombre ? (
                      <span className="font-bold text-brand-950">{evento.usuarioNombre}</span>
                    ) : (
                      <span className="text-slate-500">{evento.ip ?? 'Sin sesion'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{evento.identificador ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{resumirDetalle(evento.detalle)}</td>
                </tr>
              ))}
            </Tabla>
            <Paginacion {...pagina} />
          </>
        )}
      </CardContent>
    </Card>

    <PurgaDatosModal
      abierto={purgaAbierta}
      onCerrar={() => {
        setPurgaAbierta(false)
        cargar()
      }}
    />
    </>
  )
}

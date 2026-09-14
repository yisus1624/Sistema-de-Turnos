'use client'

/**
 * Carga de la agenda del dia desde el reporte del hospital.
 *
 * Vive dentro de la pantalla de citas, que la comparten el administrador
 * (`/admin/citas`) y el operador (`/operador/agenda`). Los dos pueden cargarla:
 * es lo primero que se hace al abrir el hospital, y si dependiera solo del
 * administrador, el dia que no llegue temprano no habria agenda.
 *
 * POR QUE EL RESUMEN ES TAN INSISTENTE. Una carga que "sale bien" pero deja 40
 * pacientes fuera es peor que una que falla, porque nadie se entera hasta que
 * el paciente esta en el mostrador diciendo que tiene cita y el sistema dice
 * que no. Por eso al terminar no se muestra un "listo": se muestra cuantas
 * entraron, cuantas se dejaron como estaban, que se creo en el catalogo y
 * —sobre todo— que filas se rechazaron y por que, con el numero de fila del
 * archivo para poder ir a mirarlas.
 */

import { useRef, useState } from 'react'
import { UploadSimple, Warning, CheckCircle } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { mensajeDeError } from '@/lib/api/cliente'
import { toast } from '@/components/ui/toast'

interface ErrorFila {
  fila: number
  motivo: string
}

interface ResumenCarga {
  archivo: string
  fechas: string[]
  filasLeidas: number
  creadas: number
  actualizadas: number
  omitidas: number
  errores: ErrorFila[]
  serviciosNuevos: string[]
  consultoriosNuevos: string[]
  profesionalesNuevos: string[]
  citasNoIncluidas: number
  jornadasAjustadas: Array<{ nombre: string; jornada: 'MANANA' | 'TARDE' | 'COMPLETA' }>
}

/** Como se lee cada jornada en la pantalla. */
const ETIQUETA_JORNADA: Record<'MANANA' | 'TARDE' | 'COMPLETA', string> = {
  MANANA: 'Solo mañana',
  TARDE: 'Solo tarde',
  COMPLETA: 'Dia completo',
}

/** Cuantos rechazos se listan antes de resumir el resto. */
const ERRORES_VISIBLES = 20

export default function CargarReporteCitas({ alTerminar }: { alTerminar: () => void }) {
  const entrada = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [resumen, setResumen] = useState<ResumenCarga | null>(null)

  async function subir(archivo: File) {
    setSubiendo(true)
    try {
      const cuerpo = new FormData()
      cuerpo.append('archivo', archivo)

      // Se usa `fetch` directo y no el cliente comun: ese pone
      // `Content-Type: application/json`, y con un formulario multiparte hay
      // que dejar que el navegador ponga el suyo con el separador. Con la
      // cabecera equivocada el servidor no encuentra el archivo.
      const respuesta = await fetch('/api/turnos/citas/importar', { method: 'POST', body: cuerpo })
      const datos = await respuesta.json().catch(() => ({}))

      if (!respuesta.ok) throw new Error(datos?.error ?? 'No se pudo cargar el archivo.')

      setResumen(datos as ResumenCarga)
      alTerminar()
    } catch (error) {
      toast.error('No se pudo cargar la agenda', mensajeDeError(error))
    } finally {
      setSubiendo(false)
      // Se limpia para que se pueda volver a elegir EL MISMO archivo: si no, el
      // navegador no dispara el evento la segunda vez y parece que el boton
      // dejo de funcionar.
      if (entrada.current) entrada.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={entrada}
        type="file"
        accept=".xml,.xls,.xlsx,text/xml,application/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(evento) => {
          const archivo = evento.target.files?.[0]
          if (archivo) subir(archivo)
        }}
      />

      <Button variant="secondary" loading={subiendo} onClick={() => entrada.current?.click()}>
        <UploadSimple size={17} weight="bold" />
        {subiendo ? 'Cargando agenda...' : 'Cargar agenda del hospital'}
      </Button>

      <Modal
        open={resumen !== null}
        onClose={() => setResumen(null)}
        size="xl"
        title="Agenda cargada"
        description={resumen?.archivo}
        headerIcon={<CheckCircle size={22} weight="fill" className="text-emerald-600" />}
        footer={<Button onClick={() => setResumen(null)}>Entendido</Button>}
      >
        {resumen ? <Resultado resumen={resumen} /> : null}
      </Modal>
    </>
  )
}

function Resultado({ resumen }: { resumen: ResumenCarga }) {
  const catalogoNuevo = [
    ...resumen.serviciosNuevos.map((n) => ({ tipo: 'Servicio', nombre: n })),
    ...resumen.consultoriosNuevos.map((n) => ({ tipo: 'Consultorio', nombre: n })),
    ...resumen.profesionalesNuevos.map((n) => ({ tipo: 'Profesional', nombre: n })),
  ]

  return (
    <div className="space-y-5 text-sm">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato etiqueta="Citas nuevas" valor={resumen.creadas} tono="verde" />
        <Dato etiqueta="Actualizadas" valor={resumen.actualizadas} />
        <Dato etiqueta="Sin cambios" valor={resumen.omitidas} />
        <Dato etiqueta="Filas leidas" valor={resumen.filasLeidas} />
      </div>

      <p className="text-slate-600">
        {resumen.fechas.length === 1
          ? `El archivo trae la agenda del ${resumen.fechas[0]}.`
          : `El archivo trae ${resumen.fechas.length} dias: ${resumen.fechas.join(', ')}.`}{' '}
        Volver a subir el mismo archivo no duplica pacientes, y las citas de quien ya registro su llegada
        se dejan como estaban.
      </p>

      {catalogoNuevo.length > 0 ? (
        <Aviso
          tono="ambar"
          titulo={`Se dieron de alta ${catalogoNuevo.length} elemento(s) del catalogo`}
          detalle="Salieron del propio reporte. Revisa en Configuracion que el consultorio de cada profesional sea el correcto; la jornada se deduce sola de las horas a las que atiende."
        >
          <ul className="mt-2 space-y-1">
            {catalogoNuevo.map((item) => (
              <li key={`${item.tipo}-${item.nombre}`} className="font-semibold text-amber-900">
                <span className="text-amber-700">{item.tipo}:</span> {item.nombre}
              </li>
            ))}
          </ul>
        </Aviso>
      ) : null}

      {resumen.jornadasAjustadas.length > 0 ? (
        <Aviso
          tono="ambar"
          titulo={`${resumen.jornadasAjustadas.length} doctor(es) cambiaron de jornada`}
          detalle="La jornada sale de las horas a las que tienen pacientes este dia: quien solo atiende antes del almuerzo queda de mañana, y quien solo despues, de tarde. Asi no aparecen en la parrilla a horas a las que no estan. Si alguno no es correcto, cambialo en Profesionales."
        >
          <ul className="mt-2 space-y-1">
            {resumen.jornadasAjustadas.map((ajuste) => (
              <li key={ajuste.nombre} className="font-semibold text-amber-900">
                {ajuste.nombre}: <span className="text-amber-700">{ETIQUETA_JORNADA[ajuste.jornada]}</span>
              </li>
            ))}
          </ul>
        </Aviso>
      ) : null}

      {resumen.citasNoIncluidas > 0 ? (
        <Aviso
          tono="ambar"
          titulo={`${resumen.citasNoIncluidas} cita(s) del sistema no venian en este archivo`}
          detalle="No se tocaron. Puede ser que las cancelaran en el hospital despues de la carga anterior, o que este reporte venga filtrado por doctor o por media jornada. Revisalas en la parrilla antes de darlas por buenas."
        />
      ) : null}

      {resumen.errores.length > 0 ? (
        <Aviso
          tono="rojo"
          titulo={`${resumen.errores.length} fila(s) no se pudieron cargar`}
          detalle="Esos pacientes NO estan en la agenda. Corrige el archivo y vuelve a subirlo, o agendalos a mano."
        >
          <ul className="mt-2 space-y-1">
            {resumen.errores.slice(0, ERRORES_VISIBLES).map((error) => (
              <li key={`${error.fila}-${error.motivo}`} className="text-red-900">
                <span className="font-black">Fila {error.fila}:</span> {error.motivo}
              </li>
            ))}
          </ul>
          {resumen.errores.length > ERRORES_VISIBLES ? (
            <p className="mt-2 font-semibold text-red-700">
              y {resumen.errores.length - ERRORES_VISIBLES} mas.
            </p>
          ) : null}
        </Aviso>
      ) : null}
    </div>
  )
}

function Dato({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono?: 'verde' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p
        className={
          tono === 'verde'
            ? 'text-2xl font-black text-emerald-700'
            : 'text-2xl font-black text-brand-900'
        }
      >
        {valor}
      </p>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{etiqueta}</p>
    </div>
  )
}

function Aviso({
  tono,
  titulo,
  detalle,
  children,
}: {
  tono: 'ambar' | 'rojo'
  titulo: string
  detalle: string
  children?: React.ReactNode
}) {
  const estilos =
    tono === 'rojo' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'

  return (
    <div className={`rounded-xl border p-3 ${estilos}`}>
      <p className="flex items-center gap-2 font-black">
        <Warning size={17} weight="fill" />
        {titulo}
      </p>
      <p className="mt-1">{detalle}</p>
      {children}
    </div>
  )
}

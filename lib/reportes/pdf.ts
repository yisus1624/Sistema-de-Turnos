/**
 * Generacion del PDF de reportes de turnos (seccion "Reportes" del menu
 * administrador). Se genera en el navegador con jsPDF: no hay servidor de
 * reportes, asi que el logo institucional se carga como imagen estatica y se
 * incrusta como data URL.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NOMBRE_INSTITUCION } from '@/components/brand/Marca'
import type { EstadoTurno, Turno } from '@/lib/turnos/types'

const RUTA_LOGO = '/img/logo-hospital.png'

const etiquetaEstado: Record<EstadoTurno, string> = {
  EN_ESPERA: 'En espera',
  LLAMADO: 'Llamado',
  EN_ATENCION: 'En atencion',
  ATENDIDO: 'Atendido',
  AUSENTE: 'Ausente',
  CANCELADO: 'Cancelado',
}

function horaCorta(iso?: string | null) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

function fechaLarga(fecha: string) {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(new Date(`${fecha}T12:00:00`))
}

let logoCache: string | null = null

async function cargarLogo(): Promise<string | null> {
  if (logoCache) return logoCache
  try {
    const respuesta = await fetch(RUTA_LOGO)
    const blob = await respuesta.blob()
    logoCache = await new Promise<string>((resolve, reject) => {
      const lector = new FileReader()
      lector.onload = () => resolve(lector.result as string)
      lector.onerror = reject
      lector.readAsDataURL(blob)
    })
    return logoCache
  } catch {
    return null
  }
}

export type FilaReporte = {
  turno: Turno
  servicioNombre: string
  moduloNombre: string
}

export async function generarReportePdf(params: {
  filas: FilaReporte[]
  fechaDesde: string
  fechaHasta: string
}) {
  const { filas, fechaDesde, fechaHasta } = params
  const logo = await cargarLogo()

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const margen = 40

  if (logo) {
    doc.addImage(logo, 'PNG', margen, 24, 44, 44)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(15, 23, 42)
  doc.text(NOMBRE_INSTITUCION, margen + 54, 42)

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(71, 85, 105)
  doc.text('Reporte de turnos', margen + 54, 58)

  const rango =
    fechaDesde === fechaHasta
      ? `Fecha: ${fechaLarga(fechaDesde)}`
      : `Del ${fechaLarga(fechaDesde)} al ${fechaLarga(fechaHasta)}`
  doc.text(rango, margen + 54, 72)

  const generadoEl = new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date())
  doc.setFontSize(9)
  doc.setTextColor(148, 163, 184)
  doc.text(`Generado el ${generadoEl}`, doc.internal.pageSize.getWidth() - margen, 30, { align: 'right' })
  doc.text(`Total de turnos: ${filas.length}`, doc.internal.pageSize.getWidth() - margen, 44, { align: 'right' })

  autoTable(doc, {
    startY: 96,
    margin: { left: margen, right: margen },
    head: [['Turno', 'Servicio', 'Modulo', 'Generado', 'Llamado', 'Cierre', 'Llamadas', 'Estado']],
    body: filas.map(({ turno, servicioNombre, moduloNombre }) => [
      turno.codigo,
      servicioNombre,
      moduloNombre,
      horaCorta(turno.fechaGeneracion),
      horaCorta(turno.horaLlamado),
      horaCorta(turno.horaAtencion),
      String(turno.vecesLlamado),
      etiquetaEstado[turno.estado],
    ]),
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })

  const nombreArchivo =
    fechaDesde === fechaHasta
      ? `reporte-turnos-${fechaDesde}.pdf`
      : `reporte-turnos-${fechaDesde}_a_${fechaHasta}.pdf`

  doc.save(nombreArchivo)
}

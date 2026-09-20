/**
 * El icono de cada servicio, deducido de su nombre.
 *
 * NO SE PUEDE GUARDAR EN EL CATALOGO: los servicios entran solos con la carga
 * diaria del reporte del hospital, con el nombre que traiga el archivo, y nadie
 * se sienta despues a elegirles un icono. Se busca por palabra dentro del
 * nombre, y lo que no encaja en ninguna se queda con el fonendoscopio, que vale
 * para cualquier consulta.
 *
 * Vive aqui y no dentro de una pantalla porque lo usan varias (turnos en curso,
 * enlaces de consultorio): si se copia, odontologia acabaria con un icono en
 * una pantalla y otro en la de al lado, y el color y la forma de un servicio
 * son justo lo que deja reconocerlo sin leer.
 */

import { createElement } from 'react'
import {
  Baby,
  Bandaids,
  Bone,
  Brain,
  Drop,
  Ear,
  Eye,
  FirstAidKit,
  Flask,
  GenderFemale,
  Heartbeat,
  Hospital,
  Microscope,
  Pill,
  Stethoscope,
  Syringe,
  Tooth,
} from '@phosphor-icons/react/dist/ssr'
import type { Icon } from '@phosphor-icons/react'

/**
 * Las reglas van de lo especifico a lo general: "Medicina Interna" tiene que
 * probar contra `interna` antes que contra `general`.
 */
const ICONOS_SERVICIO: { clave: RegExp; icono: Icon }[] = [
  { clave: /odonto|dental|diente|higiene oral/, icono: Tooth },
  { clave: /gineco|obstetr|materno|prenatal|planificacion/, icono: GenderFemale },
  { clave: /pediatr|nino sano|crecimiento|lactan/, icono: Baby },
  { clave: /psico|salud mental|psiqui/, icono: Brain },
  { clave: /cardio|hipertens|riesgo cardio/, icono: Heartbeat },
  { clave: /oftalmo|optometr|vision|ojo/, icono: Eye },
  { clave: /ortoped|traumat|fisioter|fisiatr/, icono: Bone },
  { clave: /laborator|toma de muestra|citolog/, icono: Flask },
  { clave: /patolog|microbiolog|bacteri/, icono: Microscope },
  { clave: /vacuna|inmuniz|inyecto/, icono: Syringe },
  { clave: /farmacia|medicament|dispensa/, icono: Pill },
  { clave: /otorrino|audiolog|oido/, icono: Ear },
  { clave: /curacion|herida|sutura/, icono: Bandaids },
  { clave: /urgencia|hospitaliz|triage/, icono: Hospital },
  { clave: /transfusion|hemato|sangre|donacion/, icono: Drop },
  { clave: /interna|familiar|general/, icono: FirstAidKit },
]

/** Quita tildes y baja a minusculas: el reporte del hospital no es constante. */
function sinTildes(texto: string) {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/**
 * El icono del servicio, ya pintado.
 *
 * Devuelve el elemento y no el componente a proposito: guardar un componente en
 * una variable durante el render es lo que prohibe la regla de React que vigila
 * este proyecto, porque un componente que nace en cada render pierde su estado
 * en cada render. Aqui se crea el elemento y ya.
 */
export function iconoDeServicio(nombre: string, size: number) {
  const limpio = sinTildes(nombre)
  const icono = ICONOS_SERVICIO.find((regla) => regla.clave.test(limpio))?.icono ?? Stethoscope
  return createElement(icono, { size, weight: 'fill' })
}

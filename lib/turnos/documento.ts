/**
 * El documento del paciente, escrito siempre igual.
 *
 * La importacion guardaba solo letras y digitos, la cita hecha a mano se
 * guardaba tal cual se tecleo y admisiones buscaba el texto exacto: con
 * "1.067.890.123" en el buscador, al paciente con cita se le decia que no la
 * tenia y se le mandaba a la fila de ventanilla. Se normaliza al guardar y al
 * buscar, en los dos repositorios; lo ya guardado no se reescribe, se compara
 * normalizando los dos lados.
 *
 * Fuera puntos, espacios, guiones y demas separadores, y el tipo cuando va
 * delante como palabra aparte ("CC 1067890123", "C.C. 1.067.890.123"). Las
 * letras del numero NO se tocan: un pasaporte "AB123456" sigue igual, y por eso
 * un tipo pegado al numero ("CC1067890123") tampoco se quita.
 */
const TIPOS_DE_DOCUMENTO = new Set(['CC', 'CE', 'CD', 'CN', 'TI', 'RC', 'PA', 'PE', 'PT', 'SC', 'AS', 'MS', 'DE', 'SI'])

const TIPO_DELANTE = /^([A-Z])\.?([A-Z])(?:\.?[\s:#-]+|\.)(?=[0-9A-Z])/

export function normalizarDocumento(documento: string): string {
  return sinTipoDelante(documento.trim().toUpperCase()).replace(/[^0-9A-Z]/g, '')
}

function sinTipoDelante(escrito: string) {
  const tipo = TIPO_DELANTE.exec(escrito)
  return tipo && TIPOS_DE_DOCUMENTO.has(tipo[1] + tipo[2]) ? escrito.slice(tipo[0].length) : escrito
}

/** Si dos documentos son el mismo, se hayan escrito como se hayan escrito. */
export function mismoDocumento(a: string, b: string): boolean {
  return normalizarDocumento(a) === normalizarDocumento(b)
}

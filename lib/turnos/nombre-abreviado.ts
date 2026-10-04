/**
 * Como se nombra a un paciente en las pantallas internas cuando el hospital
 * eligio la cartelera CON NOMBRE (`CARTELERA_PACIENTE`).
 *
 * Con ese diseño el codigo de turno no sale en ninguna parte: el paciente no
 * lo conoce, asi que en "Turnos en curso" o en la simulacion se le reconoce
 * por su nombre. Pero esas pantallas se miran de reojo en un puesto con gente
 * alrededor, y ahi no hace falta el nombre completo: el primer nombre y las
 * iniciales del resto bastan para saber quien es ("Juan C. P. G.").
 */
export function nombreAbreviado(nombre: string | null | undefined): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return 'Paciente'
  const [primero, ...resto] = partes
  return [primero, ...resto.map((parte) => `${parte[0].toUpperCase()}.`)].join(' ')
}

/** Si con este diseño de pantalla se habla de nombres y no de codigos. */
export function seNombraAlPaciente(diseno: string | null | undefined): boolean {
  return diseno === 'CARTELERA_PACIENTE'
}
